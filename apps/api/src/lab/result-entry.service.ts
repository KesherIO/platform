import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TemplateVersionService } from '../results/template-version.service';
import { PatientSpecies, AgeUnit, Prisma } from '@prisma/client';
import { evaluateAllFormulas } from './formula.util';

function ageToWeeks(age: number, unit: AgeUnit): number {
  switch (unit) {
    case AgeUnit.DAYS:
      return age / 7;
    case AgeUnit.WEEKS:
      return age;
    case AgeUnit.MONTHS:
      return age * 4.33;
    case AgeUnit.YEARS:
      return age * 52;
    default:
      return age * 52;
  }
}

@Injectable()
export class ResultEntryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly templateVersionService: TemplateVersionService
  ) {}

  // GET /lab/ordered-tests/:testId/result-session
  // Returns the resolved template sections + existing saved values for this test.
  async getResultSession(testId: string, labTenantId: string) {
    const test = await this.prisma.orderedTest.findFirst({
      where: { id: testId, order: { labTenantId } },
      select: {
        id: true,
        catalogItemCode: true,
        catalogItemName: true,
        status: true,
        order: {
          select: {
            id: true,
            case: {
              select: {
                patientSpecies: true,
                patientAge: true,
                patientAgeUnit: true,
              },
            },
            resultReport: {
              select: {
                id: true,
                status: true,
                observations: true,
                correctionNotes: true,
              },
            },
          },
        },
      },
    });

    if (!test) throw new NotFoundException('Ordered test not found.');

    if (test.status === 'BLOCKED' || test.status === 'CANCELLED') {
      throw new BadRequestException(
        `Cannot open result session: test is ${test.status}.`
      );
    }

    const species = test.order.case.patientSpecies as PatientSpecies;
    const ageWeeks =
      test.order.case.patientAge && test.order.case.patientAgeUnit
        ? ageToWeeks(
            test.order.case.patientAge,
            test.order.case.patientAgeUnit as AgeUnit
          )
        : null;

    const templateDef = await this.templateVersionService.resolveTemplate(
      test.catalogItemCode ?? '',
      labTenantId,
      species,
      ageWeeks
    );

    if (!templateDef?.activeVersion) {
      throw new NotFoundException(
        'No active result template found for this test.'
      );
    }

    const version = templateDef.activeVersion;

    // Get saved analyte values via ResultReportTest → analytes
    const reportTest = test.order.resultReport
      ? await this.prisma.resultReportTest.findUnique({
          where: {
            reportId_orderedTestId: {
              reportId: test.order.resultReport.id,
              orderedTestId: testId,
            },
          },
          select: {
            id: true,
            analytes: {
              select: {
                id: true,
                templateAnalyteId: true,
                numericValue: true,
                textValue: true,
                booleanValue: true,
                selectValue: true,
              },
            },
          },
        })
      : null;

    const savedAnalytes = reportTest?.analytes ?? [];
    const savedByTemplateId = new Map(
      savedAnalytes.map((a) => [a.templateAnalyteId, a])
    );

    // Build sections with analytes merged with existing values
    const sectionMap = new Map<
      string | null,
      {
        id: string | null;
        code: string | null;
        name: string | null;
        analytes: unknown[];
      }
    >();
    sectionMap.set(null, { id: null, code: null, name: null, analytes: [] });
    for (const s of version.sections) {
      sectionMap.set(s.id, {
        id: s.id,
        code: s.code ?? null,
        name: s.name,
        analytes: [],
      });
    }

    for (const analyte of version.analytes) {
      const saved = savedByTemplateId.get(analyte.id);
      const entry = {
        id: analyte.id,
        code: analyte.code,
        name: analyte.name,
        technique: analyte.technique ?? null,
        valueType: analyte.valueType,
        unit: analyte.unit ?? null,
        options: analyte.options ?? [],
        referenceRange: analyte.referenceRange ?? null,
        isHeader: analyte.isHeader,
        isRequired: analyte.isRequired,
        formula: analyte.formula ?? null,
        sortOrder: analyte.sortOrder,
        savedValueId: saved?.id ?? null,
        numericValue: saved?.numericValue ?? null,
        textValue: saved?.textValue ?? null,
        booleanValue: saved?.booleanValue ?? null,
        selectValue: saved?.selectValue ?? null,
      };
      const section =
        sectionMap.get(analyte.sectionId ?? null) ?? sectionMap.get(null)!;
      section.analytes.push(entry);
    }

    const sections = Array.from(sectionMap.values()).filter(
      (s) => s.analytes.length > 0
    );

    return {
      test: {
        id: test.id,
        name: test.catalogItemName,
        code: test.catalogItemCode,
        status: test.status,
      },
      template: {
        title: version.title,
        defaultObservations: version.defaultObservations ?? null,
        observationPhrases: version.observationPhrases ?? null,
      },
      report: test.order.resultReport
        ? {
            id: test.order.resultReport.id,
            observations: test.order.resultReport.observations,
            correctionNotes: test.order.resultReport.correctionNotes ?? null,
          }
        : null,
      sections,
    };
  }

  // PATCH /lab/ordered-tests/:testId/analytes
  // Upsert analyte values. Creates the ResultReport and ResultReportTest if needed.
  async saveAnalytes(
    testId: string,
    labTenantId: string,
    analytes: Array<{
      templateAnalyteId: string;
      numericValue?: number | null;
      textValue?: string | null;
      booleanValue?: boolean | null;
      selectValue?: string | null;
    }>,
    observations?: string | null,
    actorId?: string,
    actorName?: string
  ) {
    const test = await this.prisma.orderedTest.findFirst({
      where: { id: testId, order: { labTenantId } },
      select: {
        id: true,
        catalogItemCode: true,
        catalogItemName: true,
        status: true,
        order: {
          select: {
            id: true,
            caseId: true,
            tenantId: true,
            resultReport: { select: { id: true } },
            case: {
              select: {
                patientSpecies: true,
                patientAge: true,
                patientAgeUnit: true,
              },
            },
          },
        },
      },
    });

    if (!test) throw new NotFoundException('Ordered test not found.');

    if (test.status === 'BLOCKED' || test.status === 'CANCELLED') {
      throw new BadRequestException(
        `Cannot save analytes: test is ${test.status}.`
      );
    }

    const releaseCheck = await this.prisma.resultReportTest.findFirst({
      where: { orderedTestId: test.id },
      select: { status: true },
    });
    if (releaseCheck?.status === 'RELEASED') {
      throw new BadRequestException(
        'Cannot edit results: test has been released. Use the amendment workflow.'
      );
    }

    const species = test.order.case.patientSpecies as PatientSpecies;
    const ageWeeks =
      test.order.case.patientAge && test.order.case.patientAgeUnit
        ? ageToWeeks(
            test.order.case.patientAge,
            test.order.case.patientAgeUnit as AgeUnit
          )
        : null;

    const templateDef = await this.templateVersionService.resolveTemplate(
      test.catalogItemCode ?? '',
      labTenantId,
      species,
      ageWeeks
    );

    if (!templateDef?.activeVersion) {
      throw new NotFoundException(
        'No active result template found for this test.'
      );
    }

    const version = templateDef.activeVersion;
    const analyteById = new Map(version.analytes.map((a) => [a.id, a]));
    const sectionNameById = new Map(
      version.sections.map((s) => [s.id, s.name])
    );

    // Reject negative numeric values
    const negativeFields: string[] = [];
    for (const input of analytes) {
      if (input.numericValue != null && input.numericValue < 0) {
        const templateAnalyte = analyteById.get(input.templateAnalyteId);
        negativeFields.push(templateAnalyte?.name ?? input.templateAnalyteId);
      }
    }
    if (negativeFields.length > 0) {
      throw new BadRequestException(
        `Negative values are not allowed: ${negativeFields.join(', ')}`
      );
    }

    // Get or create the ResultReport for this order
    let reportId = test.order.resultReport?.id;
    if (!reportId) {
      const report = await this.prisma.resultReport.create({
        data: {
          orderId: test.order.id,
          caseId: test.order.caseId,
          tenantId: test.order.tenantId,
          status: 'DRAFT',
        },
        select: { id: true },
      });
      reportId = report.id;
    }

    // Get or create the ResultReportTest for this (report, orderedTest)
    let reportTest = await this.prisma.resultReportTest.findUnique({
      where: {
        reportId_orderedTestId: {
          reportId,
          orderedTestId: testId,
        },
      },
      select: { id: true },
    });

    if (!reportTest) {
      reportTest = await this.prisma.resultReportTest.create({
        data: {
          reportId,
          orderedTestId: testId,
          templateVersionId: version.id,
          templateDefinitionId: templateDef.id,
        },
        select: { id: true },
      });
    }

    // Update observations if provided
    if (observations !== undefined) {
      await this.prisma.resultReport.update({
        where: { id: reportId },
        data: { observations: observations ?? null },
      });
    }

    // Upsert each analyte value
    for (const input of analytes) {
      const templateAnalyte = analyteById.get(input.templateAnalyteId);
      if (!templateAnalyte || templateAnalyte.isHeader) continue;

      const existing = await this.prisma.resultReportAnalyte.findFirst({
        where: {
          reportTestId: reportTest.id,
          templateAnalyteId: input.templateAnalyteId,
        },
        select: { id: true },
      });

      const data = {
        numericValue: input.numericValue ?? null,
        textValue: input.textValue ?? null,
        booleanValue: input.booleanValue ?? null,
        selectValue: input.selectValue ?? null,
      };

      if (existing) {
        await this.prisma.resultReportAnalyte.update({
          where: { id: existing.id },
          data,
        });
      } else {
        await this.prisma.resultReportAnalyte.create({
          data: {
            reportTestId: reportTest.id,
            templateAnalyteId: input.templateAnalyteId,
            code: templateAnalyte.code,
            name: templateAnalyte.name,
            technique: templateAnalyte.technique ?? null,
            unit: templateAnalyte.unit ?? null,
            valueType: templateAnalyte.valueType,
            sectionName: templateAnalyte.sectionId
              ? sectionNameById.get(templateAnalyte.sectionId) ?? null
              : null,
            sortOrder: templateAnalyte.sortOrder,
            isHeader: templateAnalyte.isHeader,
            formula: templateAnalyte.formula ?? null,
            ...data,
          },
        });
      }
    }

    // Compute formula analytes from just-saved input values
    const formulaAnalytes = version.analytes.filter(
      (a) => a.formula && !a.isHeader
    );
    if (formulaAnalytes.length > 0) {
      const savedRows = await this.prisma.resultReportAnalyte.findMany({
        where: { reportTestId: reportTest.id },
        select: { code: true, numericValue: true },
      });
      const savedByCode = new Map(savedRows.map((r) => [r.code, r]));

      const allForEval = version.analytes
        .filter((a) => !a.isHeader)
        .map((a) => ({
          code: a.code,
          formula: a.formula ?? null,
          numericValue: savedByCode.get(a.code)?.numericValue ?? null,
        }));

      // Include sibling tests' values for cross-test formula references (e.g. Anion Gap)
      const siblingRows = await this.prisma.resultReportAnalyte.findMany({
        where: {
          reportTest: { reportId, orderedTestId: { not: testId } },
        },
        select: { code: true, numericValue: true },
      });
      const currentCodes = new Set(allForEval.map((a) => a.code));
      for (const sibling of siblingRows) {
        if (!currentCodes.has(sibling.code)) {
          allForEval.push({
            code: sibling.code,
            formula: null,
            numericValue: sibling.numericValue,
          });
        }
      }

      const computed = evaluateAllFormulas(allForEval);

      for (const fa of formulaAnalytes) {
        const value = computed[fa.code] ?? null;
        const existing = await this.prisma.resultReportAnalyte.findFirst({
          where: { reportTestId: reportTest.id, templateAnalyteId: fa.id },
          select: { id: true },
        });

        if (existing) {
          await this.prisma.resultReportAnalyte.update({
            where: { id: existing.id },
            data: { numericValue: value },
          });
        } else {
          await this.prisma.resultReportAnalyte.create({
            data: {
              reportTestId: reportTest.id,
              templateAnalyteId: fa.id,
              code: fa.code,
              name: fa.name,
              technique: fa.technique ?? null,
              unit: fa.unit ?? null,
              valueType: fa.valueType,
              sectionName: fa.sectionId
                ? sectionNameById.get(fa.sectionId) ?? null
                : null,
              sortOrder: fa.sortOrder,
              isHeader: false,
              formula: fa.formula ?? null,
              numericValue: value,
            },
          });
        }
      }
    }

    // Transition test to IN_PROGRESS if still READY
    if (test.status === 'READY') {
      await this.prisma.orderedTest.update({
        where: { id: testId },
        data: {
          status: 'IN_PROGRESS',
          startedAt: new Date(),
          version: { increment: 1 },
        },
      });
      if (actorId && actorName) {
        await this.prisma.timelineEvent.create({
          data: {
            orderId: test.order.id,
            eventType: 'PROCESSING_STARTED',
            actorId,
            actorName,
            description: `${test.catalogItemName}: result entry started`,
            metadata: { orderedTestId: testId },
          },
        });
      }
    }

    return { reportId, saved: analytes.length };
  }

  // POST /lab/ordered-tests/:testId/submit-results
  // Marks test as RESULTS_ENTERED so it can move to review/release.
  async submitResults(
    testId: string,
    labTenantId: string,
    actorId: string,
    actorName: string
  ) {
    const test = await this.prisma.orderedTest.findFirst({
      where: { id: testId, order: { labTenantId } },
      select: {
        id: true,
        catalogItemCode: true,
        catalogItemName: true,
        status: true,
        order: {
          select: {
            id: true,
            resultReport: { select: { id: true, status: true } },
            case: {
              select: {
                patientSpecies: true,
                patientAge: true,
                patientAgeUnit: true,
              },
            },
          },
        },
      },
    });

    if (!test) throw new NotFoundException('Ordered test not found.');

    if (!['READY', 'IN_PROGRESS'].includes(test.status)) {
      throw new ForbiddenException(
        `Cannot submit results for a test in status ${test.status}.`
      );
    }

    const reportId = test.order.resultReport?.id;
    if (!reportId) {
      throw new BadRequestException('No report exists — save analytes first.');
    }

    const reportTest = await this.prisma.resultReportTest.findUnique({
      where: {
        reportId_orderedTestId: { reportId, orderedTestId: testId },
      },
      select: { id: true },
    });

    if (!reportTest) {
      throw new BadRequestException(
        'No report test exists — save analytes first.'
      );
    }

    const species = test.order.case.patientSpecies as PatientSpecies;
    const ageWeeks =
      test.order.case.patientAge && test.order.case.patientAgeUnit
        ? ageToWeeks(
            test.order.case.patientAge,
            test.order.case.patientAgeUnit as AgeUnit
          )
        : null;

    const templateDef = await this.templateVersionService.resolveTemplate(
      test.catalogItemCode ?? '',
      labTenantId,
      species,
      ageWeeks
    );

    if (!templateDef?.activeVersion) {
      throw new NotFoundException(
        'No active result template found for this test.'
      );
    }

    const version = templateDef.activeVersion;
    const savedRows = await this.prisma.resultReportAnalyte.findMany({
      where: { reportTestId: reportTest.id },
      select: {
        templateAnalyteId: true,
        code: true,
        numericValue: true,
        textValue: true,
        booleanValue: true,
        selectValue: true,
      },
    });
    const savedByTemplateId = new Map(
      savedRows.map((r) => [r.templateAnalyteId, r])
    );

    const missingFields: string[] = [];
    for (const analyte of version.analytes) {
      if (analyte.isHeader || analyte.formula || !analyte.isRequired) continue;
      const saved = savedByTemplateId.get(analyte.id);
      const hasValue =
        saved &&
        (saved.numericValue !== null ||
          (saved.textValue !== null && saved.textValue !== '') ||
          saved.booleanValue !== null ||
          (saved.selectValue !== null && saved.selectValue !== ''));
      if (!hasValue) {
        missingFields.push(analyte.name);
      }
    }

    if (missingFields.length > 0) {
      throw new BadRequestException(
        `Missing required fields: ${missingFields.join(', ')}`
      );
    }

    // Recompute formulas and validate they all resolve
    const allForEval = version.analytes
      .filter((a) => !a.isHeader)
      .map((a) => ({
        code: a.code,
        formula: a.formula ?? null,
        numericValue: savedByTemplateId.get(a.id)?.numericValue ?? null,
      }));

    // Include sibling tests' values for cross-test formula references (e.g. Anion Gap)
    const siblingRows = await this.prisma.resultReportAnalyte.findMany({
      where: {
        reportTest: { reportId, orderedTestId: { not: testId } },
      },
      select: { code: true, numericValue: true },
    });
    const currentCodes = new Set(allForEval.map((a) => a.code));
    for (const sibling of siblingRows) {
      if (!currentCodes.has(sibling.code)) {
        allForEval.push({
          code: sibling.code,
          formula: null,
          numericValue: sibling.numericValue,
        });
      }
    }

    const computed = evaluateAllFormulas(allForEval);
    const sectionNameById = new Map(
      version.sections.map((s) => [s.id, s.name])
    );

    const availableCodes = new Set(allForEval.map((a) => a.code));
    const failedFormulas: string[] = [];
    const formulaAnalytes = version.analytes.filter(
      (a) => a.formula && !a.isHeader
    );
    for (const fa of formulaAnalytes) {
      const value = computed[fa.code] ?? null;
      if (value === null) {
        const refs =
          fa
            .formula!.match(/\[([^\]]+)\]/g)
            ?.map((r: string) => r.slice(1, -1)) ?? [];
        const allRefsAvailable = refs.every((ref: string) =>
          availableCodes.has(ref)
        );
        if (allRefsAvailable) {
          failedFormulas.push(fa.name);
        }
      }

      // Upsert formula value
      const existing = await this.prisma.resultReportAnalyte.findFirst({
        where: { reportTestId: reportTest.id, templateAnalyteId: fa.id },
        select: { id: true },
      });
      if (existing) {
        await this.prisma.resultReportAnalyte.update({
          where: { id: existing.id },
          data: { numericValue: value },
        });
      } else {
        await this.prisma.resultReportAnalyte.create({
          data: {
            reportTestId: reportTest.id,
            templateAnalyteId: fa.id,
            code: fa.code,
            name: fa.name,
            technique: fa.technique ?? null,
            unit: fa.unit ?? null,
            valueType: fa.valueType,
            sectionName: fa.sectionId
              ? sectionNameById.get(fa.sectionId) ?? null
              : null,
            sortOrder: fa.sortOrder,
            isHeader: false,
            formula: fa.formula ?? null,
            numericValue: value,
          },
        });
      }
    }

    if (failedFormulas.length > 0) {
      throw new BadRequestException(
        `Formulas could not be computed: ${failedFormulas.join(', ')}`
      );
    }

    await this.prisma.orderedTest.update({
      where: { id: testId },
      data: {
        status: 'RESULTS_ENTERED',
        completedAt: new Date(),
        version: { increment: 1 },
      },
    });

    if (test.order.resultReport?.status === 'RELEASED') {
      await this.prisma.resultReport.update({
        where: { id: test.order.resultReport.id },
        data: { status: 'DRAFT' },
      });
    }

    await this.prisma.timelineEvent.create({
      data: {
        orderId: test.order.id,
        eventType: 'RESULTS_COMPLETED',
        actorId,
        actorName,
        description: `${test.catalogItemName}: results entered`,
        metadata: { orderedTestId: testId },
      },
    });

    return { status: 'RESULTS_ENTERED' };
  }

  async batchSaveAndSubmit(
    labTenantId: string,
    tests: Array<{
      testId: string;
      analytes: Array<{
        templateAnalyteId: string;
        numericValue?: number | null;
        textValue?: string | null;
        booleanValue?: boolean | null;
        selectValue?: string | null;
      }>;
      observations?: string | null;
    }>,
    submitAfterSave: boolean,
    actorId: string,
    actorName: string
  ) {
    const testIds = tests.map((t) => t.testId);

    // 1. Batch-fetch all ordered tests
    const orderedTests = await this.prisma.orderedTest.findMany({
      where: { id: { in: testIds }, order: { labTenantId } },
      select: {
        id: true,
        catalogItemCode: true,
        catalogItemName: true,
        status: true,
        order: {
          select: {
            id: true,
            caseId: true,
            tenantId: true,
            resultReport: { select: { id: true, status: true } },
            case: {
              select: {
                patientSpecies: true,
                patientAge: true,
                patientAgeUnit: true,
              },
            },
          },
        },
      },
    });

    const testMap = new Map(orderedTests.map((t) => [t.id, t]));
    if (orderedTests.length === 0) return { results: [] };

    const firstTest = orderedTests[0];
    const species = firstTest.order.case.patientSpecies as PatientSpecies;
    const ageWeeks =
      firstTest.order.case.patientAge && firstTest.order.case.patientAgeUnit
        ? ageToWeeks(
            firstTest.order.case.patientAge,
            firstTest.order.case.patientAgeUnit as AgeUnit
          )
        : null;

    // 2. Resolve templates once per unique code (shared species/age across batch)
    const uniqueCodes = [
      ...new Set(orderedTests.map((t) => t.catalogItemCode ?? '')),
    ];
    const templateCache = new Map<
      string,
      Awaited<ReturnType<typeof this.templateVersionService.resolveTemplate>>
    >();
    await Promise.all(
      uniqueCodes.map(async (code) => {
        const tmpl = await this.templateVersionService.resolveTemplate(
          code,
          labTenantId,
          species,
          ageWeeks
        );
        templateCache.set(code, tmpl);
      })
    );

    // 3. Ensure ResultReport exists
    let reportId = firstTest.order.resultReport?.id;
    if (!reportId) {
      const report = await this.prisma.resultReport.create({
        data: {
          orderId: firstTest.order.id,
          caseId: firstTest.order.caseId,
          tenantId: firstTest.order.tenantId,
          status: 'DRAFT',
        },
        select: { id: true },
      });
      reportId = report.id;
    }

    // 4. Ensure ResultReportTest rows exist for all tests
    const existingReportTests = await this.prisma.resultReportTest.findMany({
      where: { reportId, orderedTestId: { in: testIds } },
      select: { id: true, orderedTestId: true },
    });
    const reportTestByTestId = new Map(
      existingReportTests.map((rt) => [rt.orderedTestId, rt.id])
    );
    for (const ot of orderedTests) {
      if (!reportTestByTestId.has(ot.id)) {
        const templateDef = templateCache.get(ot.catalogItemCode ?? '');
        if (!templateDef?.activeVersion) continue;
        const rt = await this.prisma.resultReportTest.create({
          data: {
            reportId,
            orderedTestId: ot.id,
            templateVersionId: templateDef.activeVersion.id,
            templateDefinitionId: templateDef.id,
          },
          select: { id: true },
        });
        reportTestByTestId.set(ot.id, rt.id);
      }
    }

    // 5. Batch-fetch all existing analyte rows for these report tests
    const reportTestIds = [...reportTestByTestId.values()];
    const existingAnalytes = await this.prisma.resultReportAnalyte.findMany({
      where: { reportTestId: { in: reportTestIds } },
      select: {
        id: true,
        reportTestId: true,
        templateAnalyteId: true,
        code: true,
        numericValue: true,
      },
    });
    const existingByKey = new Map(
      existingAnalytes.map((a) => [
        `${a.reportTestId}::${a.templateAnalyteId}`,
        a,
      ])
    );

    // 6. Save all analyte values (batch creates + batch updates)
    const creates: Prisma.ResultReportAnalyteUncheckedCreateInput[] = [];
    const updates: Array<{ id: string; data: Record<string, unknown> }> = [];

    for (const entry of tests) {
      const ot = testMap.get(entry.testId);
      if (!ot || ot.status === 'BLOCKED' || ot.status === 'CANCELLED') continue;

      const rtId = reportTestByTestId.get(entry.testId);
      if (!rtId) continue;

      const templateDef = templateCache.get(ot.catalogItemCode ?? '');
      if (!templateDef?.activeVersion) continue;

      const version = templateDef.activeVersion;
      const analyteById = new Map(version.analytes.map((a) => [a.id, a]));
      const sectionNameById = new Map(
        version.sections.map((s) => [s.id, s.name])
      );

      for (const input of entry.analytes) {
        const templateAnalyte = analyteById.get(input.templateAnalyteId);
        if (!templateAnalyte || templateAnalyte.isHeader) continue;

        const data = {
          numericValue: input.numericValue ?? null,
          textValue: input.textValue ?? null,
          booleanValue: input.booleanValue ?? null,
          selectValue: input.selectValue ?? null,
        };

        const key = `${rtId}::${input.templateAnalyteId}`;
        const existing = existingByKey.get(key);

        if (existing) {
          updates.push({ id: existing.id, data });
        } else {
          creates.push({
            reportTestId: rtId,
            templateAnalyteId: input.templateAnalyteId,
            code: templateAnalyte.code,
            name: templateAnalyte.name,
            technique: templateAnalyte.technique ?? null,
            unit: templateAnalyte.unit ?? null,
            valueType: templateAnalyte.valueType,
            sectionName: templateAnalyte.sectionId
              ? sectionNameById.get(templateAnalyte.sectionId) ?? null
              : null,
            sortOrder: templateAnalyte.sortOrder,
            isHeader: templateAnalyte.isHeader,
            formula: templateAnalyte.formula ?? null,
            ...data,
          });
        }
      }
    }

    // Execute batch writes in a transaction
    await this.prisma.$transaction([
      ...creates.map((data) =>
        this.prisma.resultReportAnalyte.create({ data })
      ),
      ...updates.map(({ id, data }) =>
        this.prisma.resultReportAnalyte.update({ where: { id }, data })
      ),
    ]);

    // 7. Update observations (last one wins since they share a report)
    const lastObs = [...tests]
      .reverse()
      .find((t) => t.observations !== undefined);
    if (lastObs?.observations !== undefined) {
      await this.prisma.resultReport.update({
        where: { id: reportId },
        data: { observations: lastObs.observations ?? null },
      });
    }

    // 8. Compute formulas for all tests (sibling values now in DB)
    const allSavedRows = await this.prisma.resultReportAnalyte.findMany({
      where: { reportTestId: { in: reportTestIds } },
      select: {
        reportTestId: true,
        code: true,
        numericValue: true,
        templateAnalyteId: true,
        id: true,
      },
    });
    const allSavedByCode = new Map<string, number | null>();
    for (const r of allSavedRows) {
      allSavedByCode.set(r.code, r.numericValue);
    }

    const formulaCreates: Prisma.ResultReportAnalyteUncheckedCreateInput[] = [];
    const formulaUpdates: Array<{ id: string; numericValue: number | null }> =
      [];

    for (const ot of orderedTests) {
      const templateDef = templateCache.get(ot.catalogItemCode ?? '');
      if (!templateDef?.activeVersion) continue;

      const rtId = reportTestByTestId.get(ot.id);
      if (!rtId) continue;

      const version = templateDef.activeVersion;
      const formulaAnalytes = version.analytes.filter(
        (a) => a.formula && !a.isHeader
      );
      if (formulaAnalytes.length === 0) continue;

      const sectionNameById = new Map(
        version.sections.map((s) => [s.id, s.name])
      );

      const allForEval = version.analytes
        .filter((a) => !a.isHeader)
        .map((a) => ({
          code: a.code,
          formula: a.formula ?? null,
          numericValue: allSavedByCode.get(a.code) ?? null,
        }));

      const currentCodes = new Set(allForEval.map((a) => a.code));
      for (const [code, val] of allSavedByCode) {
        if (!currentCodes.has(code)) {
          allForEval.push({ code, formula: null, numericValue: val });
        }
      }

      const computed = evaluateAllFormulas(allForEval);

      for (const fa of formulaAnalytes) {
        const value = computed[fa.code] ?? null;
        const key = `${rtId}::${fa.id}`;
        const existing =
          existingByKey.get(key) ??
          allSavedRows.find(
            (r) => r.reportTestId === rtId && r.templateAnalyteId === fa.id
          );

        if (existing) {
          formulaUpdates.push({ id: existing.id, numericValue: value });
        } else {
          formulaCreates.push({
            reportTestId: rtId,
            templateAnalyteId: fa.id,
            code: fa.code,
            name: fa.name,
            technique: fa.technique ?? null,
            unit: fa.unit ?? null,
            valueType: fa.valueType,
            sectionName: fa.sectionId
              ? sectionNameById.get(fa.sectionId) ?? null
              : null,
            sortOrder: fa.sortOrder,
            isHeader: false,
            formula: fa.formula ?? null,
            numericValue: value,
          });
        }
      }
    }

    if (formulaCreates.length > 0 || formulaUpdates.length > 0) {
      await this.prisma.$transaction([
        ...formulaCreates.map((data) =>
          this.prisma.resultReportAnalyte.create({ data })
        ),
        ...formulaUpdates.map(({ id, numericValue }) =>
          this.prisma.resultReportAnalyte.update({
            where: { id },
            data: { numericValue },
          })
        ),
      ]);
    }

    // 9. Transition READY tests to IN_PROGRESS
    const now = new Date();
    const readyTests = orderedTests.filter((t) => t.status === 'READY');
    if (readyTests.length > 0) {
      await this.prisma.$transaction([
        ...readyTests.map((t) =>
          this.prisma.orderedTest.update({
            where: { id: t.id },
            data: {
              status: 'IN_PROGRESS',
              startedAt: now,
              version: { increment: 1 },
            },
          })
        ),
        ...readyTests.map((t) =>
          this.prisma.timelineEvent.create({
            data: {
              orderId: t.order.id,
              eventType: 'PROCESSING_STARTED',
              actorId,
              actorName,
              description: `${t.catalogItemName}: result entry started`,
              metadata: { orderedTestId: t.id },
            },
          })
        ),
      ]);
    }

    const results = tests.map((entry) => ({
      testId: entry.testId,
      reportId,
      saved: entry.analytes.length,
      submitted: false,
    }));

    // 10. Submit phase — validate and transition to RESULTS_ENTERED
    if (submitAfterSave) {
      // Re-fetch statuses after save phase
      const freshTests = await this.prisma.orderedTest.findMany({
        where: { id: { in: testIds } },
        select: { id: true, status: true },
      });
      const statusMap = new Map(freshTests.map((t) => [t.id, t.status]));

      // Re-fetch all saved analytes for validation
      const allAnalyteRows = await this.prisma.resultReportAnalyte.findMany({
        where: { reportTestId: { in: reportTestIds } },
        select: {
          reportTestId: true,
          templateAnalyteId: true,
          code: true,
          numericValue: true,
          textValue: true,
          booleanValue: true,
          selectValue: true,
        },
      });

      const submittable: typeof orderedTests = [];
      const allFailedFormulas: string[] = [];

      for (const ot of orderedTests) {
        const status = statusMap.get(ot.id);
        if (!status || !['READY', 'IN_PROGRESS'].includes(status)) continue;

        const templateDef = templateCache.get(ot.catalogItemCode ?? '');
        if (!templateDef?.activeVersion) continue;

        const rtId = reportTestByTestId.get(ot.id);
        if (!rtId) continue;

        const version = templateDef.activeVersion;
        const rtAnalytes = allAnalyteRows.filter(
          (a) => a.reportTestId === rtId
        );
        const savedByTemplateId = new Map(
          rtAnalytes.map((r) => [r.templateAnalyteId, r])
        );

        // Check required fields
        const missingFields: string[] = [];
        for (const analyte of version.analytes) {
          if (analyte.isHeader || analyte.formula || !analyte.isRequired)
            continue;
          const saved = savedByTemplateId.get(analyte.id);
          const hasValue =
            saved &&
            (saved.numericValue !== null ||
              (saved.textValue !== null && saved.textValue !== '') ||
              saved.booleanValue !== null ||
              (saved.selectValue !== null && saved.selectValue !== ''));
          if (!hasValue) missingFields.push(analyte.name);
        }
        if (missingFields.length > 0) {
          throw new BadRequestException(
            `Missing required fields for ${
              ot.catalogItemName
            }: ${missingFields.join(', ')}`
          );
        }

        // Validate formulas
        const formulaAnalytes = version.analytes.filter(
          (a) => a.formula && !a.isHeader
        );
        const allCodes = new Set(allAnalyteRows.map((r) => r.code));
        for (const fa of formulaAnalytes) {
          const saved = savedByTemplateId.get(fa.id);
          if (!saved || saved.numericValue === null) {
            const refs =
              fa
                .formula!.match(/\[([^\]]+)\]/g)
                ?.map((r: string) => r.slice(1, -1)) ?? [];
            if (refs.every((ref: string) => allCodes.has(ref))) {
              allFailedFormulas.push(`${ot.catalogItemName}: ${fa.name}`);
            }
          }
        }

        submittable.push(ot);
      }

      if (allFailedFormulas.length > 0) {
        throw new BadRequestException(
          `Formulas could not be computed: ${allFailedFormulas.join(', ')}`
        );
      }

      if (submittable.length > 0) {
        const submitNow = new Date();
        await this.prisma.$transaction([
          ...submittable.map((t) =>
            this.prisma.orderedTest.update({
              where: { id: t.id },
              data: {
                status: 'RESULTS_ENTERED',
                completedAt: submitNow,
                version: { increment: 1 },
              },
            })
          ),
          ...submittable.map((t) =>
            this.prisma.timelineEvent.create({
              data: {
                orderId: t.order.id,
                eventType: 'RESULTS_COMPLETED',
                actorId,
                actorName,
                description: `${t.catalogItemName}: results entered`,
                metadata: { orderedTestId: t.id },
              },
            })
          ),
        ]);

        if (firstTest.order.resultReport?.status === 'RELEASED') {
          await this.prisma.resultReport.update({
            where: { id: reportId },
            data: { status: 'DRAFT' },
          });
        }

        for (const r of results) {
          if (submittable.some((s) => s.id === r.testId)) {
            r.submitted = true;
          }
        }
      }
    }

    return { results };
  }

  async batchGetResultSessions(testIds: string[], labTenantId: string) {
    const tests = await this.prisma.orderedTest.findMany({
      where: { id: { in: testIds }, order: { labTenantId } },
      select: {
        id: true,
        status: true,
        catalogItemCode: true,
        catalogItemName: true,
        order: {
          select: {
            id: true,
            case: {
              select: {
                patientSpecies: true,
                patientAge: true,
                patientAgeUnit: true,
              },
            },
            resultReport: {
              select: {
                id: true,
                status: true,
                observations: true,
                correctionNotes: true,
              },
            },
          },
        },
      },
    });

    const eligible = tests.filter(
      (t) => t.status !== 'CANCELLED' && t.status !== 'BLOCKED'
    );
    if (eligible.length === 0) return [];

    // Resolve templates once per unique (catalogCode, species, ageWeeks)
    const templateCache = new Map<
      string,
      Awaited<ReturnType<typeof this.templateVersionService.resolveTemplate>>
    >();
    const cacheKeys = new Map<
      string,
      { code: string; species: PatientSpecies; ageWeeks: number | null }
    >();
    for (const t of eligible) {
      const code = t.catalogItemCode ?? '';
      const species = t.order.case.patientSpecies as PatientSpecies;
      const ageWeeks =
        t.order.case.patientAge && t.order.case.patientAgeUnit
          ? ageToWeeks(
              t.order.case.patientAge,
              t.order.case.patientAgeUnit as AgeUnit
            )
          : null;
      const key = `${code}::${species}::${ageWeeks}`;
      if (!cacheKeys.has(key)) {
        cacheKeys.set(key, { code, species, ageWeeks });
      }
    }
    await Promise.all(
      Array.from(cacheKeys.entries()).map(
        async ([key, { code, species, ageWeeks }]) => {
          const tmpl = await this.templateVersionService.resolveTemplate(
            code,
            labTenantId,
            species,
            ageWeeks
          );
          templateCache.set(key, tmpl);
        }
      )
    );

    // Batch-fetch all saved analyte values in one query
    const reportIds = new Set<string>();
    for (const t of eligible) {
      if (t.order.resultReport) reportIds.add(t.order.resultReport.id);
    }
    const eligibleIds = eligible.map((t) => t.id);
    const reportTests =
      reportIds.size > 0
        ? await this.prisma.resultReportTest.findMany({
            where: {
              reportId: { in: Array.from(reportIds) },
              orderedTestId: { in: eligibleIds },
            },
            select: {
              id: true,
              orderedTestId: true,
              analytes: {
                select: {
                  id: true,
                  templateAnalyteId: true,
                  numericValue: true,
                  textValue: true,
                  booleanValue: true,
                  selectValue: true,
                },
              },
            },
          })
        : [];
    const reportTestByOrderedId = new Map(
      reportTests.map((rt) => [rt.orderedTestId, rt])
    );

    return eligible.map((test) => {
      const species = test.order.case.patientSpecies as PatientSpecies;
      const ageWeeks =
        test.order.case.patientAge && test.order.case.patientAgeUnit
          ? ageToWeeks(
              test.order.case.patientAge,
              test.order.case.patientAgeUnit as AgeUnit
            )
          : null;
      const code = test.catalogItemCode ?? '';
      const key = `${code}::${species}::${ageWeeks}`;
      const templateDef = templateCache.get(key) ?? null;

      if (!templateDef?.activeVersion) {
        return {
          test: {
            id: test.id,
            name: test.catalogItemName,
            code: test.catalogItemCode,
            status: test.status,
          },
          template: null,
          report: null,
          sections: [],
        };
      }

      const version = templateDef.activeVersion;
      const reportTest = reportTestByOrderedId.get(test.id);
      const savedAnalytes = reportTest?.analytes ?? [];
      const savedByTemplateId = new Map(
        savedAnalytes.map((a) => [a.templateAnalyteId, a])
      );

      const sectionMap = new Map<
        string | null,
        {
          id: string | null;
          code: string | null;
          name: string | null;
          analytes: unknown[];
        }
      >();
      sectionMap.set(null, { id: null, code: null, name: null, analytes: [] });
      for (const s of version.sections) {
        sectionMap.set(s.id, {
          id: s.id,
          code: s.code ?? null,
          name: s.name,
          analytes: [],
        });
      }

      for (const analyte of version.analytes) {
        const saved = savedByTemplateId.get(analyte.id);
        const entry = {
          id: analyte.id,
          code: analyte.code,
          name: analyte.name,
          technique: analyte.technique ?? null,
          valueType: analyte.valueType,
          unit: analyte.unit ?? null,
          options: analyte.options ?? [],
          referenceRange: analyte.referenceRange ?? null,
          isHeader: analyte.isHeader,
          isRequired: analyte.isRequired,
          formula: analyte.formula ?? null,
          sortOrder: analyte.sortOrder,
          savedValueId: saved?.id ?? null,
          numericValue: saved?.numericValue ?? null,
          textValue: saved?.textValue ?? null,
          booleanValue: saved?.booleanValue ?? null,
          selectValue: saved?.selectValue ?? null,
        };
        const section =
          sectionMap.get(analyte.sectionId ?? null) ?? sectionMap.get(null)!;
        section.analytes.push(entry);
      }

      const sections = Array.from(sectionMap.values()).filter(
        (s) => s.analytes.length > 0
      );

      return {
        test: {
          id: test.id,
          name: test.catalogItemName,
          code: test.catalogItemCode,
          status: test.status,
        },
        template: {
          title: version.title,
          defaultObservations: version.defaultObservations ?? null,
          observationPhrases: version.observationPhrases ?? null,
        },
        report: test.order.resultReport
          ? {
              id: test.order.resultReport.id,
              observations: test.order.resultReport.observations,
              correctionNotes: test.order.resultReport.correctionNotes ?? null,
            }
          : null,
        sections,
      };
    });
  }
}
