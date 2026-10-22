import { ConflictException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { ResultEntryService } from '../lab/result-entry.service';
import { InstrumentProcessorService } from './instrument-processor.service';
import { decodeFrame, contentHash, parseOru, toStoredSummary } from './hl7-oru';
import { makeFrame, sampleHl7 } from './test-frames';

/** Build the stored message row the processor reads, from synthetic HL7. */
function messageRow(opts: Parameters<typeof sampleHl7>[0] = {}, over: Record<string, unknown> = {}) {
  const payload = decodeFrame(makeFrame(sampleHl7(opts)));
  const oru = parseOru(payload);
  return {
    id: 'm1', labTenantId: 'lab1', analyzerId: 'an1', credentialId: 'c1', isComplete: true, status: 'RECEIVED',
    sampleId: oru.patient.sampleId, controlId: oru.controlId, contentHash: contentHash(oru, payload),
    observationTime: new Date('2026-10-20T00:14:57Z'), receivedAtConnector: new Date('2026-10-20T00:15:00Z'),
    hasExpiredReagent: oru.observations.some((o) => o.userFlag === 'O'),
    parsed: toStoredSummary(oru, payload), analyzer: { name: 'VH30' }, ...over,
  };
}
const mapping = (parameterCode: string, analyzerUnit: string, analyteCode: string, multiplier = 1) => ({ parameterCode, analyzerUnit, catalogItemCode: 'CBC', analyteCode, multiplier });

describe('InstrumentProcessorService', () => {
  const prisma = {
    instrumentMessage: { findUniqueOrThrow: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    instrumentSampleLink: { findMany: jest.fn() },
    instrumentParameterMapping: { findMany: jest.fn() },
    order: { findFirst: jest.fn() },
    orderedTest: { update: jest.fn() },
    timelineEvent: { create: jest.fn() },
  };
  const resultEntry = { getResultSession: jest.fn(), saveAnalytes: jest.fn() };
  const service = new InstrumentProcessorService(prisma as unknown as PrismaService, resultEntry as unknown as ResultEntryService);
  const session = (savedWbc: number | null = null) => ({
    sections: [{ analytes: [
      { id: 'a-wbc', code: 'WBC', isHeader: false, numericValue: savedWbc, textValue: null, booleanValue: null, selectValue: null },
      { id: 'a-hgb', code: 'HGB', isHeader: false, numericValue: null, textValue: null, booleanValue: null, selectValue: null },
    ] }],
  });
  const statusWritten = () => prisma.instrumentMessage.update.mock.calls.at(-1)?.[0].data;

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.instrumentMessage.findUniqueOrThrow.mockResolvedValue(messageRow());
    prisma.instrumentMessage.findMany.mockResolvedValue([]); // no earlier messages of this run
    prisma.instrumentMessage.update.mockResolvedValue({});
    prisma.instrumentMessage.updateMany.mockResolvedValue({ count: 0 });
    prisma.instrumentMessage.findUnique.mockResolvedValue({ parsed: {} });
    prisma.instrumentSampleLink.findMany.mockResolvedValue([{ id: 'l1', orderId: 'o1' }]);
    prisma.instrumentParameterMapping.findMany.mockResolvedValue([mapping('WBC', '10^9/L', 'WBC'), mapping('HGB', 'g/dL', 'HGB')]);
    prisma.order.findFirst.mockResolvedValue({ id: 'o1', status: 'RECEIVED_BY_LAB', orderedTests: [{ id: 't1', catalogItemCode: 'CBC', catalogItemName: 'CBC', status: 'READY' }] });
    resultEntry.getResultSession.mockResolvedValue(session());
    resultEntry.saveAnalytes.mockResolvedValue({ reportId: 'r', saved: 2 });
    prisma.orderedTest.update.mockResolvedValue({});
    prisma.timelineEvent.create.mockResolvedValue({});
  });

  it('imports mapped numeric values as a draft through saveAnalytes, scoped to the message\'s lab', async () => {
    expect(await service.process('m1')).toBe('IMPORTED');
    expect(resultEntry.saveAnalytes).toHaveBeenCalledWith(
      't1', 'lab1',
      [{ templateAnalyteId: 'a-wbc', numericValue: 13.23 }, { templateAnalyteId: 'a-hgb', numericValue: 5.7 }],
      undefined, 'connector:c1', 'VH30 (connector)'
    );
    expect(prisma.orderedTest.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: expect.objectContaining({ entryMethod: 'INSTRUMENT', resultEntrySource: 'DIRECT_INTEGRATION', analyzerId: 'an1' }) });
    expect(prisma.timelineEvent.create.mock.calls[0][0].data).toMatchObject({ orderId: 'o1', eventType: 'INSTRUMENT_RESULTS_IMPORTED' });
    expect(statusWritten()).toMatchObject({ status: 'IMPORTED', importedCount: 2 });
  });

  it('looks up links, mappings and the order only within the message\'s own lab', async () => {
    await service.process('m1');
    expect(prisma.instrumentSampleLink.findMany.mock.calls[0][0].where).toMatchObject({ labTenantId: 'lab1', analyzerId: 'an1', sampleId: '168', endedAt: null });
    expect(prisma.instrumentParameterMapping.findMany.mock.calls[0][0].where).toEqual({ labTenantId: 'lab1', analyzerId: 'an1' });
    expect(prisma.order.findFirst.mock.calls[0][0].where).toEqual({ id: 'o1', labTenantId: 'lab1' });
  });

  it('applies the explicit multiplier and keeps what was measured (no float noise)', async () => {
    prisma.instrumentMessage.findUniqueOrThrow.mockResolvedValue(messageRow({}, { parsed: { ...messageRow().parsed, parameters: [{ code: 'HGB', valueType: 'NM', value: '57', unit: 'g/L', referenceRange: '', abnormalFlag: '', userFlag: '' }] } }));
    prisma.instrumentParameterMapping.findMany.mockResolvedValue([mapping('HGB', 'g/L', 'HGB', 0.1)]);
    await service.process('m1');
    expect(resultEntry.saveAnalytes.mock.calls[0][2]).toEqual([{ templateAnalyteId: 'a-hgb', numericValue: 5.7 }]);
  });

  it('never processes an incomplete transfer', async () => {
    prisma.instrumentMessage.findUniqueOrThrow.mockResolvedValue(messageRow({}, { isComplete: false, status: 'INCOMPLETE' }));
    expect(await service.process('m1')).toBe('INCOMPLETE');
    expect(prisma.instrumentSampleLink.findMany).not.toHaveBeenCalled();
    expect(resultEntry.saveAnalytes).not.toHaveBeenCalled();
    expect(prisma.instrumentMessage.update).not.toHaveBeenCalled();
  });

  it('same run + same content = DUPLICATE, no import', async () => {
    const row = messageRow();
    prisma.instrumentMessage.findMany.mockResolvedValue([{ id: 'old', status: 'IMPORTED', contentHash: row.contentHash, parsed: row.parsed, orderedTestId: 't1' }]);
    expect(await service.process('m1')).toBe('DUPLICATE');
    expect(statusWritten()).toMatchObject({ status: 'DUPLICATE', previousMessageId: 'old' });
    expect(resultEntry.saveAnalytes).not.toHaveBeenCalled();
  });

  it('same run, different content after an import = NEEDS_REVIEW (CONTENT_CHANGED) with a diff, nothing written', async () => {
    const earlier = messageRow({ wbc: '13.23' });
    prisma.instrumentMessage.findUniqueOrThrow.mockResolvedValue(messageRow({ wbc: '14.00' }));
    prisma.instrumentMessage.findMany.mockResolvedValue([{ id: 'old', status: 'IMPORTED', contentHash: earlier.contentHash, parsed: earlier.parsed, orderedTestId: 't1' }]);
    expect(await service.process('m1')).toBe('NEEDS_REVIEW');
    const data = statusWritten();
    expect(data.reasons).toEqual(['CONTENT_CHANGED']);
    expect(data.diff.changed[0]).toMatchObject({ code: 'WBC', before: { value: '13.23' }, after: { value: '14.00' } });
    expect(resultEntry.saveAnalytes).not.toHaveBeenCalled();
  });

  it('applies an approved CONTENT_CHANGED but never an unapprovable reason', async () => {
    const earlier = messageRow({ wbc: '13.23' });
    prisma.instrumentMessage.findUniqueOrThrow.mockResolvedValue(messageRow({ wbc: '14.00' }));
    prisma.instrumentMessage.findMany.mockResolvedValue([{ id: 'old', status: 'IMPORTED', contentHash: earlier.contentHash, parsed: earlier.parsed, orderedTestId: 't1' }]);
    expect(await service.process('m1', { approved: ['CONTENT_CHANGED'], actor: { id: 'u1', name: 'Rev' } })).toBe('IMPORTED');
    expect(resultEntry.saveAnalytes.mock.calls[0][2][0]).toEqual({ templateAnalyteId: 'a-wbc', numericValue: 14 });
    expect(resultEntry.saveAnalytes.mock.calls[0][4]).toBe('u1');

    // UNMATCHED can't be waved through
    jest.clearAllMocks();
    prisma.instrumentMessage.findUniqueOrThrow.mockResolvedValue(messageRow());
    prisma.instrumentMessage.findMany.mockResolvedValue([]);
    prisma.instrumentSampleLink.findMany.mockResolvedValue([]);
    expect(await service.process('m1', { approved: ['UNMATCHED', 'CONTENT_CHANGED'] })).toBe('UNMATCHED');
    expect(resultEntry.saveAnalytes).not.toHaveBeenCalled();
  });

  it('does not write analytes the template COMPUTES (formula): they are reported as computed, not counted as imported', async () => {
    resultEntry.getResultSession.mockResolvedValue({
      sections: [{ analytes: [
        { id: 'a-wbc', code: 'WBC', isHeader: false, formula: null, numericValue: null, textValue: null, booleanValue: null, selectValue: null },
        { id: 'a-hgb', code: 'HGB', isHeader: false, formula: '([HCT]*10)/[RBC]', numericValue: null, textValue: null, booleanValue: null, selectValue: null },
      ] }],
    });
    expect(await service.process('m1')).toBe('IMPORTED');
    expect(resultEntry.saveAnalytes.mock.calls[0][2]).toEqual([{ templateAnalyteId: 'a-wbc', numericValue: 13.23 }]);
    const data = statusWritten();
    expect(data.importedCount).toBe(1);
    expect(data.parsed.import.formulaComputed).toEqual([{ analyteCode: 'HGB', analyzerCode: 'HGB', analyzerValue: 5.7 }]);
    expect(data.parsed.import.plan.map((p: { analyteCode: string }) => p.analyteCode)).toEqual(['WBC']);
    expect(prisma.timelineEvent.create.mock.calls[0][0].data.description).toMatch(/: 1 analyzer values/);
  });

  it('when every mapped value is computed by the template there is nothing to write: held for review, nothing saved', async () => {
    prisma.instrumentParameterMapping.findMany.mockResolvedValue([mapping('HGB', 'g/dL', 'HGB')]);
    resultEntry.getResultSession.mockResolvedValue({ sections: [{ analytes: [{ id: 'a-hgb', code: 'HGB', isHeader: false, formula: '[X]', numericValue: null, textValue: null, booleanValue: null, selectValue: null }] }] });
    expect(await service.process('m1')).toBe('NEEDS_REVIEW');
    expect(statusWritten().reasons).toEqual(['NO_MAPPED_PARAMETERS']);
    expect(resultEntry.saveAnalytes).not.toHaveBeenCalled();
  });

  describe('approval rechecks the CURRENT draft and release state', () => {
    const earlier = messageRow({ wbc: '13.23' });
    const imported = (over = {}) => ({
      id: 'old', status: 'IMPORTED', contentHash: earlier.contentHash, orderedTestId: 't1', importedAt: new Date('2026-10-20T01:00:00Z'),
      parsed: { ...earlier.parsed, import: { plan: [{ catalogItemCode: 'CBC', analyteCode: 'WBC', value: 13.23 }, { catalogItemCode: 'CBC', analyteCode: 'HGB', value: 5.7 }] } },
      ...over,
    });
    const sessionWith = (wbc: number | null, hgb: number | null = 5.7) => ({
      sections: [{ analytes: [
        { id: 'a-wbc', code: 'WBC', isHeader: false, numericValue: wbc, textValue: null, booleanValue: null, selectValue: null },
        { id: 'a-hgb', code: 'HGB', isHeader: false, numericValue: hgb, textValue: null, booleanValue: null, selectValue: null },
      ] }],
    });
    beforeEach(() => {
      prisma.instrumentMessage.findUniqueOrThrow.mockResolvedValue(messageRow({ wbc: '14.00' }));
      prisma.instrumentMessage.findMany.mockResolvedValue([imported()]);
    });

    it('untouched draft: only CONTENT_CHANGED is raised', async () => {
      resultEntry.getResultSession.mockResolvedValue(sessionWith(13.23));
      await service.process('m1');
      expect(statusWritten().reasons).toEqual(['CONTENT_CHANGED']);
    });

    it('a technician edited the draft after the import: DRAFT_MODIFIED_SINCE_IMPORT is raised too', async () => {
      resultEntry.getResultSession.mockResolvedValue(sessionWith(9));
      expect(await service.process('m1')).toBe('NEEDS_REVIEW');
      expect(statusWritten().reasons).toEqual(['CONTENT_CHANGED', 'DRAFT_MODIFIED_SINCE_IMPORT']);
      expect(resultEntry.saveAnalytes).not.toHaveBeenCalled();
    });

    it('an analyte cleared in the draft counts as edited', async () => {
      resultEntry.getResultSession.mockResolvedValue(sessionWith(13.23, null));
      await service.process('m1');
      expect(statusWritten().reasons).toContain('DRAFT_MODIFIED_SINCE_IMPORT');
    });

    it('an approval made on an old screen (CONTENT_CHANGED only) does NOT overwrite a draft edited since: it goes back to review', async () => {
      resultEntry.getResultSession.mockResolvedValue(sessionWith(9));
      expect(await service.process('m1', { approved: ['CONTENT_CHANGED'], actor: { id: 'u1', name: 'Rev' } })).toBe('NEEDS_REVIEW');
      expect(resultEntry.saveAnalytes).not.toHaveBeenCalled();
      expect(statusWritten().reasons).toContain('DRAFT_MODIFIED_SINCE_IMPORT');
    });

    it('approving both reasons knowingly imports, replacing the edited draft', async () => {
      resultEntry.getResultSession.mockResolvedValue(sessionWith(9));
      expect(await service.process('m1', { approved: ['CONTENT_CHANGED', 'DRAFT_MODIFIED_SINCE_IMPORT'], actor: { id: 'u1', name: 'Rev' } })).toBe('IMPORTED');
      expect(resultEntry.saveAnalytes.mock.calls[0][2][0]).toEqual({ templateAnalyteId: 'a-wbc', numericValue: 14 });
    });

    it('if the test was submitted or released since, the approval is refused by the result-entry rules and nothing is written', async () => {
      resultEntry.getResultSession.mockResolvedValue(sessionWith(13.23));
      resultEntry.saveAnalytes.mockRejectedValue(new ConflictException({ code: 'TESTS_NOT_EDITABLE', message: 'already released — use an amendment' }));
      expect(await service.process('m1', { approved: ['CONTENT_CHANGED'], actor: { id: 'u1', name: 'Rev' } })).toBe('NEEDS_REVIEW');
      expect(statusWritten().reasons).toContain('TEST_NOT_EDITABLE');
      expect(statusWritten().processingError).toMatch(/released/);
      expect(prisma.orderedTest.update).not.toHaveBeenCalled();
      expect(prisma.timelineEvent.create).not.toHaveBeenCalled();
    });
  });

  it('expired reagent is held on its own reason code', async () => {
    prisma.instrumentMessage.findUniqueOrThrow.mockResolvedValue(messageRow({ flag: 'O' }));
    expect(await service.process('m1')).toBe('NEEDS_REVIEW');
    expect(statusWritten().reasons).toEqual(['EXPIRED_REAGENT']);
  });

  it('no link = UNMATCHED; two different orders = AMBIGUOUS; neither queries the order', async () => {
    prisma.instrumentSampleLink.findMany.mockResolvedValue([]);
    expect(await service.process('m1')).toBe('UNMATCHED');
    prisma.instrumentSampleLink.findMany.mockResolvedValue([{ id: 'l1', orderId: 'o1' }, { id: 'l2', orderId: 'o2' }]);
    expect(await service.process('m1')).toBe('AMBIGUOUS');
    expect(prisma.order.findFirst).not.toHaveBeenCalled();
  });

  it('a unit with no mapping is held (UNIT_MISMATCH); an unmapped parameter is just ignored', async () => {
    prisma.instrumentParameterMapping.findMany.mockResolvedValue([mapping('HGB', 'g/L', 'HGB', 0.1), mapping('WBC', '10^9/L', 'WBC')]);
    expect(await service.process('m1')).toBe('NEEDS_REVIEW'); // HGB arrives as g/dL, only g/L is mapped
    expect(statusWritten().reasons).toEqual(['UNIT_MISMATCH:HGB:g/dL']);

    prisma.instrumentParameterMapping.findMany.mockResolvedValue([mapping('WBC', '10^9/L', 'WBC')]); // HGB not mapped at all
    expect(await service.process('m1')).toBe('IMPORTED');
    expect(resultEntry.saveAnalytes.mock.calls.at(-1)?.[2]).toEqual([{ templateAnalyteId: 'a-wbc', numericValue: 13.23 }]);
  });

  it('protects typed values, a missing analyte, a missing test and a test that cannot take results', async () => {
    resultEntry.getResultSession.mockResolvedValue(session(9));
    expect(await service.process('m1')).toBe('NEEDS_REVIEW');
    expect(statusWritten().reasons).toEqual(['EXISTING_MANUAL_VALUES']);

    resultEntry.getResultSession.mockResolvedValue({ sections: [{ analytes: [{ id: 'a-wbc', code: 'WBC', isHeader: false, numericValue: null, textValue: null, booleanValue: null, selectValue: null }] }] });
    await service.process('m1');
    expect(statusWritten().reasons).toEqual(['ANALYTE_NOT_IN_TEMPLATE:HGB']);

    resultEntry.getResultSession.mockResolvedValue(session());
    prisma.order.findFirst.mockResolvedValue({ id: 'o1', status: 'RECEIVED_BY_LAB', orderedTests: [] });
    await service.process('m1');
    expect(statusWritten().reasons).toEqual(['NO_MATCHING_TEST:CBC']);

    prisma.order.findFirst.mockResolvedValue({ id: 'o1', status: 'RECEIVED_BY_LAB', orderedTests: [{ id: 't1', catalogItemCode: 'CBC', catalogItemName: 'CBC', status: 'IN_REVIEW' }] });
    resultEntry.saveAnalytes.mockRejectedValue(new ConflictException({ code: 'TESTS_NOT_EDITABLE', message: "in review — the reviewer must request corrections first" }));
    expect(await service.process('m1')).toBe('NEEDS_REVIEW');
    expect(statusWritten().reasons).toContain('TEST_NOT_EDITABLE');
    expect(prisma.orderedTest.update).not.toHaveBeenCalled(); // nothing marked as imported
  });

  it('a cancelled order is not imported into', async () => {
    prisma.order.findFirst.mockResolvedValue({ id: 'o1', status: 'CANCELLED', orderedTests: [] });
    expect(await service.process('m1')).toBe('NEEDS_REVIEW');
    expect(statusWritten().reasons).toEqual(['ORDER_NOT_AVAILABLE']);
  });
});
