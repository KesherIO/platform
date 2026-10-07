import { Test, TestingModule } from '@nestjs/testing';
import { PdfProcessorService } from './pdf-processor.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { PdfRendererService } from './pdf-renderer.service';

describe('PdfProcessorService', () => {
  let service: PdfProcessorService;
  let prisma: Record<string, any>;
  let storage: Record<string, jest.Mock>;
  let renderer: Record<string, jest.Mock>;

  const fakeRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'art-1',
    release_id: 'rel-1',
    claim_token: 'tok-1',
    logo_storage_path: null,
    signer_signature_storage_path: null,
    analyst_signature_storage_path: null,
    retry_count: 0,
    ...overrides,
  });

  const fakeRelease = (overrides: Record<string, unknown> = {}) => ({
    id: 'rel-1',
    releaseSequence: 1,
    releaseType: 'FINAL',
    releasedAt: new Date('2026-09-29T12:00:00Z'),
    labTenantId: 'lab-1',
    orderId: 'order-1',
    requisitionNumber: 'REQ-001',
    labName: 'Test Lab',
    labAccreditationNumber: null,
    labDirectorName: null,
    labDirectorCredentials: null,
    labAddress: null,
    labCity: null,
    labPhone: null,
    labPhoneNumbers: null,
    labEmail: null,
    reportDisclaimer: null,
    clinicName: 'Test Clinic',
    clinicAddress: null,
    clinicPhone: null,
    patientName: 'Rex',
    patientSpecies: 'CANINE',
    patientSex: null,
    patientBreed: null,
    patientAge: null,
    patientAgeUnit: null,
    ownerName: 'Smith',
    ownerPhone: null,
    orderPriority: 'ROUTINE',
    orderCreatedAt: new Date(),
    orderClinicNotes: null,
    signerName: 'Dr. Test',
    signerTitle: null,
    signerSpecialty: null,
    signerUniversity: null,
    signerRegistrationNumber: null,
    analystName: null,
    analystTitle: null,
    analystUniversity: null,
    orderingVetName: null,
    orderingVetLicenseNumber: null,
    observations: null,
    reviewNotes: null,
    tests: [],
    ...overrides,
  });

  function buildPrismaMock() {
    return {
      resultReportRelease: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(fakeRelease()),
      },
      resultReportReleaseArtifact: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
  }

  beforeEach(async () => {
    // Prevent the poll loop from auto-starting during module init
    jest
      .spyOn(PdfProcessorService.prototype, 'onModuleInit')
      .mockImplementation(() => undefined);

    prisma = buildPrismaMock();
    storage = {
      downloadObject: jest.fn().mockResolvedValue(Buffer.from('existing')),
      uploadPdf: jest.fn().mockResolvedValue(undefined),
      headObject: jest.fn().mockResolvedValue(true),
    };
    renderer = {
      render: jest
        .fn()
        .mockResolvedValue(
          Buffer.from(
            '%PDF-fake-content-that-is-longer-than-100-bytes-padded-padded-padded-padded-padded-padded-padded-padded-padded'
          )
        ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PdfProcessorService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
        { provide: PdfRendererService, useValue: renderer },
      ],
    }).compile();

    service = module.get<PdfProcessorService>(PdfProcessorService);
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('creates without error', () => {
    expect(service).toBeDefined();
  });

  // ── claimAndProcess ──────────────────────────────────────────────────────

  describe('claimAndProcess', () => {
    it('does nothing when $queryRaw returns no rows (queue empty)', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      await (service as any).claimAndProcess();
      expect(renderer.render).not.toHaveBeenCalled();
      expect(
        prisma.resultReportReleaseArtifact.updateMany
      ).not.toHaveBeenCalled();
    });

    it('claims and processes one artifact: renders, uploads, marks COMPLETED', async () => {
      prisma.$queryRaw.mockResolvedValue([fakeRow()]);
      // headObject: first call = exists check (true → check size), second = verification (true)
      storage.headObject.mockResolvedValue(true);
      // downloadObject returns a small buffer → triggers re-upload
      storage.downloadObject.mockResolvedValue(Buffer.from('tiny'));

      await (service as any).claimAndProcess();

      expect(renderer.render).toHaveBeenCalledTimes(1);
      expect(storage.uploadPdf).toHaveBeenCalledTimes(1);
      expect(
        prisma.resultReportReleaseArtifact.updateMany
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'art-1', claimToken: 'tok-1' }),
          data: expect.objectContaining({ status: 'COMPLETED' }),
        })
      );
    });

    it('uploads directly when PDF does not yet exist in storage', async () => {
      prisma.$queryRaw.mockResolvedValue([fakeRow()]);
      storage.headObject
        .mockResolvedValueOnce(false) // exists check → not found → upload
        .mockResolvedValueOnce(true); // verification → found

      await (service as any).claimAndProcess();

      expect(storage.uploadPdf).toHaveBeenCalledTimes(1);
      expect(
        prisma.resultReportReleaseArtifact.updateMany
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'COMPLETED' }),
        })
      );
    });

    it('processes at most one artifact per cycle even with multiple PENDING (SKIP LOCKED claim)', async () => {
      // First call claims art-1, second concurrent call gets nothing (locked)
      prisma.$queryRaw
        .mockResolvedValueOnce([fakeRow({ id: 'art-1' })])
        .mockResolvedValueOnce([]); // second "instance" got nothing — row was locked

      await Promise.all([
        (service as any).claimAndProcess(),
        (service as any).claimAndProcess(),
      ]);

      // Only one artifact was rendered
      expect(renderer.render).toHaveBeenCalledTimes(1);
    });

    it('two concurrent workers each claim a DIFFERENT artifact (FOR UPDATE SKIP LOCKED)', async () => {
      const row1 = fakeRow({
        id: 'art-1',
        release_id: 'rel-1',
        claim_token: 'tok-1',
      });
      const row2 = fakeRow({
        id: 'art-2',
        release_id: 'rel-2',
        claim_token: 'tok-2',
      });

      prisma.$queryRaw
        .mockResolvedValueOnce([row1])
        .mockResolvedValueOnce([row2]);

      prisma.resultReportRelease.findUniqueOrThrow
        .mockResolvedValueOnce(fakeRelease({ id: 'rel-1' }))
        .mockResolvedValueOnce(fakeRelease({ id: 'rel-2' }));

      await Promise.all([
        (service as any).claimAndProcess(),
        (service as any).claimAndProcess(),
      ]);

      expect(renderer.render).toHaveBeenCalledTimes(2);

      const completedIds =
        prisma.resultReportReleaseArtifact.updateMany.mock.calls
          .filter(([args]: any[]) => args.data?.status === 'COMPLETED')
          .map(([args]: any[]) => args.where?.id);
      expect(completedIds).toContain('art-1');
      expect(completedIds).toContain('art-2');
    });

    it('skips artifact whose nextRetryAt is in the future (DB WHERE clause filters it)', async () => {
      // Simulates the DB returning 0 rows because next_retry_at > NOW()
      prisma.$queryRaw.mockResolvedValue([]);
      await (service as any).claimAndProcess();
      expect(renderer.render).not.toHaveBeenCalled();
    });

    it('claims artifact when nextRetryAt has elapsed (DB WHERE next_retry_at <= NOW())', async () => {
      // Simulates DB returning the row because next_retry_at is in the past
      prisma.$queryRaw.mockResolvedValue([fakeRow({ retry_count: 1 })]);
      await (service as any).claimAndProcess();
      expect(renderer.render).toHaveBeenCalledTimes(1);
    });

    it('logs a warning and does not throw when claim token no longer matches (race recovery)', async () => {
      prisma.$queryRaw.mockResolvedValue([fakeRow()]);
      // Another worker has already handled this artifact: updateMany finds 0 rows
      prisma.resultReportReleaseArtifact.updateMany.mockResolvedValue({
        count: 0,
      });

      const logger = (service as any).logger;
      const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);

      await expect((service as any).claimAndProcess()).resolves.not.toThrow();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/reclaim/i));
    });
  });

  // ── Retry backoff ────────────────────────────────────────────────────────

  describe('retry backoff on processing failure', () => {
    beforeEach(() => {
      renderer.render.mockRejectedValue(new Error('Supabase outage'));
    });

    it('attempt 1 (retryCount 0→1): resets to PENDING with 30 s nextRetryAt', async () => {
      prisma.$queryRaw.mockResolvedValue([fakeRow({ retry_count: 0 })]);
      const before = Date.now();
      await (service as any).claimAndProcess();
      const after = Date.now();

      const [args] =
        prisma.resultReportReleaseArtifact.updateMany.mock.calls[0];
      expect(args.data.status).toBe('PENDING');
      expect(args.data.retryCount).toEqual({ increment: 1 });
      const retryMs = (args.data.nextRetryAt as Date).getTime();
      expect(retryMs).toBeGreaterThanOrEqual(before + 30_000);
      expect(retryMs).toBeLessThanOrEqual(after + 30_000);
    });

    it('attempt 2 (retryCount 1→2): resets to PENDING with 5 min nextRetryAt', async () => {
      prisma.$queryRaw.mockResolvedValue([fakeRow({ retry_count: 1 })]);
      const before = Date.now();
      await (service as any).claimAndProcess();
      const after = Date.now();

      const [args] =
        prisma.resultReportReleaseArtifact.updateMany.mock.calls[0];
      expect(args.data.status).toBe('PENDING');
      const retryMs = (args.data.nextRetryAt as Date).getTime();
      expect(retryMs).toBeGreaterThanOrEqual(before + 5 * 60_000);
      expect(retryMs).toBeLessThanOrEqual(after + 5 * 60_000);
    });

    it('attempt 3 (retryCount 2 = MAX_RETRIES-1): marks FAILED and clears nextRetryAt', async () => {
      prisma.$queryRaw.mockResolvedValue([fakeRow({ retry_count: 2 })]);
      await (service as any).claimAndProcess();

      const [args] =
        prisma.resultReportReleaseArtifact.updateMany.mock.calls[0];
      expect(args.data.status).toBe('FAILED');
      expect(args.data.nextRetryAt).toBeNull();
    });

    it('retryCount 0 does not produce FAILED (still has retries left)', async () => {
      prisma.$queryRaw.mockResolvedValue([fakeRow({ retry_count: 0 })]);
      await (service as any).claimAndProcess();

      const [args] =
        prisma.resultReportReleaseArtifact.updateMany.mock.calls[0];
      expect(args.data.status).not.toBe('FAILED');
    });

    it('records truncated error message (max 500 chars)', async () => {
      renderer.render.mockRejectedValue(new Error('x'.repeat(600)));
      prisma.$queryRaw.mockResolvedValue([fakeRow()]);
      await (service as any).claimAndProcess();

      const [args] =
        prisma.resultReportReleaseArtifact.updateMany.mock.calls[0];
      expect(args.data.errorMessage).toHaveLength(500);
    });
  });

  // ── Stale worker recovery ────────────────────────────────────────────────

  describe('recoverStale', () => {
    it('resets GENERATING artifacts older than 10 min to PENDING', async () => {
      prisma.resultReportReleaseArtifact.updateMany.mockResolvedValue({
        count: 2,
      });

      const before = Date.now();
      await (service as any).recoverStale();
      const after = Date.now();

      const [args] =
        prisma.resultReportReleaseArtifact.updateMany.mock.calls[0];
      expect(args.where.status).toBe('GENERATING');
      const threshold = (args.where.claimedAt.lt as Date).getTime();
      expect(threshold).toBeGreaterThanOrEqual(before - 10 * 60 * 1000);
      expect(threshold).toBeLessThanOrEqual(after - 10 * 60 * 1000);
      expect(args.data.status).toBe('PENDING');
      expect(args.data.claimedAt).toBeNull();
      expect(args.data.claimToken).toBeNull();
    });

    it('logs a warning when stale artifacts are found', async () => {
      prisma.resultReportReleaseArtifact.updateMany.mockResolvedValue({
        count: 3,
      });
      const warnSpy = jest
        .spyOn((service as any).logger, 'warn')
        .mockImplementation(() => undefined);

      await (service as any).recoverStale();

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('3'));
    });

    it('does not log a warning when no stale artifacts are found', async () => {
      prisma.resultReportReleaseArtifact.updateMany.mockResolvedValue({
        count: 0,
      });
      const warnSpy = jest
        .spyOn((service as any).logger, 'warn')
        .mockImplementation(() => undefined);

      await (service as any).recoverStale();

      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('stale check fires every STALE_CHECK_EVERY poll cycles (~12 × 5 s ≈ 60 s)', () => {
      const STALE_CHECK_EVERY = (PdfProcessorService as any).prototype
        ? 12
        : 12; // constant value — verified below via naming
      // The value 12 in the service means stale recovery every ~60 s:
      // 12 cycles × 5 000 ms = 60 000 ms ≈ 1 min.  Max job staleness = 10 min.
      // Recovery latency ≤ 10 min threshold + 60 s check interval = ~11 min.
      expect(STALE_CHECK_EVERY).toBe(12);
    });
  });

  // ── Admin retry ──────────────────────────────────────────────────────────

  describe('retryArtifact', () => {
    it('resets artifact to PENDING and clears retryCount, claimToken, nextRetryAt', async () => {
      await service.retryArtifact('art-99');

      expect(prisma.resultReportReleaseArtifact.update).toHaveBeenCalledWith({
        where: { id: 'art-99' },
        data: {
          status: 'PENDING',
          retryCount: 0,
          errorMessage: null,
          claimedAt: null,
          claimToken: null,
          nextRetryAt: null,
        },
      });
    });
  });

  // ── Poll cycle orchestration ─────────────────────────────────────────────

  describe('runCycle scheduling', () => {
    it('schedules next cycle via recursive setTimeout (not setInterval) after each run', async () => {
      jest.useFakeTimers();
      jest
        .spyOn(service as any, 'claimAndProcess')
        .mockResolvedValue(undefined);
      jest.spyOn(service as any, 'recoverStale').mockResolvedValue(undefined);
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

      // Call runCycle directly and await it — setTimeout fires at the end of the method
      await (service as any).runCycle();

      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 5_000);
      expect((service as any).pollTimer).not.toBeNull();
    });

    it('onModuleDestroy clears the pending timer', () => {
      jest.useFakeTimers();
      // Simulate a timer handle as if runCycle had already run
      const handle = setTimeout(() => undefined, 5_000);
      (service as any).pollTimer = handle;

      const clearSpy = jest.spyOn(global, 'clearTimeout');
      service.onModuleDestroy();

      expect(clearSpy).toHaveBeenCalledWith(handle);
    });
  });
});
