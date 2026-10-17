import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
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

/** What a test's template is resolved from. */
type TemplateKeyed = {
  catalogItemCode: string | null;
  templateDefinitionId: string | null;
};

type TemplateVersionForEntry = NonNullable<
  NonNullable<
    Awaited<ReturnType<TemplateVersionService['resolveTemplateForTest']>>
  >['activeVersion']
>;

/** Ordered-test statuses normal result entry may write to. */
const EDITABLE_TEST_STATUSES = ['READY', 'IN_PROGRESS', 'RESULTS_ENTERED'];

/** Interactive transactions for result writes (row lock wait included). */
const ENTRY_TX_OPTIONS = { maxWait: 5000, timeout: 20000 };

@Injectable()
export class ResultEntryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly templateVersionService: TemplateVersionService
  ) {}

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Normal entry may only change a test that is being worked on. Released
   * tests (COMPLETED) change only through an amendment; tests in review only
   * after the reviewer requests corrections. Same rule as the result entry
   * screens, which are read-only for every other status.
   */
  private notEditableReason(
    testStatus: string,
    reportTestStatus: string | null | undefined
  ): string | null {
    if (reportTestStatus === 'RELEASED' || testStatus === 'COMPLETED') {
      return 'already released — use an amendment';
    }
    if (reportTestStatus === 'IN_REVIEW' || testStatus === 'IN_REVIEW') {
      return 'in review — the reviewer must request corrections first';
    }
    if (!EDITABLE_TEST_STATUSES.includes(testStatus)) {
      return `status is ${testStatus}`;
    }
    return null;
  }

  /** 409 listing every test that can't be edited, or nothing. */
  private assertEditable(
    tests: Array<{
      id: string;
      catalogItemName: string | null;
      status: string;
    }>,
    reportTestStatusByTestId: Map<string | null, string>
  ) {
    const blocked = tests
      .map((t) => ({
        testId: t.id,
        name: t.catalogItemName ?? t.id,
        reason: this.notEditableReason(
          t.status,
          reportTestStatusByTestId.get(t.id)
        ),
      }))
      .filter((t) => t.reason !== null);
    if (blocked.length > 0) {
      throw new ConflictException({
        code: 'TESTS_NOT_EDITABLE',
        message: `Results can't be changed: ${blocked
          .map((b) => `${b.name} (${b.reason})`)
          .join('; ')}`,
        tests: blocked,
      });
    }
  }

  /**
   * Inside a transaction: the order's report (created if missing), locked
   * with the same row lock release, amendments and submit-for-review take,
   * then every test re-checked. A release that committed after the first
   * check is seen here, and one that starts later waits for this commit.
   */
  private async lockReportAndRecheck(
    tx: Prisma.TransactionClient,
    order: { id: string; caseId: string; tenantId: string },
    testIds: string[]
  ) {
    const report = await tx.resultReport.upsert({
      where: { orderId: order.id },
      create: {
        orderId: order.id,
        caseId: order.caseId,
        tenantId: order.tenantId,
        status: 'DRAFT',
      },
      update: {},
      select: { id: true },
    });
    await tx.$queryRaw`SELECT id FROM result_reports WHERE id = ${report.id} FOR UPDATE`;

    const locked = await tx.resultReport.findUniqueOrThrow({
      where: { id: report.id },
      select: { id: true, status: true },
    });
    const fresh = await tx.orderedTest.findMany({
      where: { id: { in: testIds } },
      select: { id: true, status: true, catalogItemName: true },
    });
    const reportTests = await tx.resultReportTest.findMany({
      where: { reportId: report.id, orderedTestId: { in: testIds } },
      select: { id: true, orderedTestId: true, status: true },
    });
    this.assertEditable(
      fresh,
      new Map(reportTests.map((rt) => [rt.orderedTestId, rt.status]))
    );
    return { report: locked, reportTests };
  }

  private computeAgeWeeks(
    patientAge: number | null,
    patientAgeUnit: string | null
  ): number | null {
    return patientAge && patientAgeUnit
      ? ageToWeeks(patientAge, patientAgeUnit as AgeUnit)
      : null;
  }

  /** Cache key for a test's template — a manual pick wins over the code match. */
  private templateKey(test: {
    catalogItemCode: string | null;
    templateDefinitionId: string | null;
  }): string {
    return test.templateDefinitionId
      ? `def:${test.templateDefinitionId}`
      : test.catalogItemCode ?? '';
  }

  private async resolveTemplateOrThrow(
    test: {
      catalogItemCode: string | null;
      templateDefinitionId: string | null;
    },
    labTenantId: string,
    species: PatientSpecies,
    ageWeeks: number | null
  ) {
    const def = await this.templateVersionService.resolveTemplateForTest(
      test,
      labTenantId,
      species,
      ageWeeks
    );
    if (!def?.activeVersion) {
      throw new NotFoundException(
        'No active result template found for this test.'
      );
    }
    return { def, version: def.activeVersion };
  }

  private analyteHasValue(
    saved:
      | {
          numericValue: number | null;
          textValue: string | null;
          booleanValue: boolean | null;
          selectValue: string | null;
        }
      | null
      | undefined
  ): boolean {
    return !!(
      saved &&
      (saved.numericValue !== null ||
        (saved.textValue !== null && saved.textValue !== '') ||
        saved.booleanValue !== null ||
        (saved.selectValue !== null && saved.selectValue !== ''))
    );
  }

  private validateRequiredFields(
    analytes: Array<{
      id: string;
      name: string;
      isHeader: boolean;
      formula: string | null;
      isRequired: boolean;
    }>,
    savedByTemplateId: Map<
      string | null,
      {
        numericValue: number | null;
        textValue: string | null;
        booleanValue: boolean | null;
        selectValue: string | null;
      }
    >
  ): string[] {
    const missing: string[] = [];
    for (const analyte of analytes) {
      if (analyte.isHeader || analyte.formula || !analyte.isRequired) continue;
      if (!this.analyteHasValue(savedByTemplateId.get(analyte.id))) {
        missing.push(analyte.name);
      }
    }
    return missing;
  }

  /**
   * Released tests show their latest release's values, not the result-entry
   * rows: approving an amendment creates a new release but never updates
   * ResultReportAnalyte, so the lab kept seeing the original values. Matched
   * by analyte code; tests never released (or analytes missing from the
   * release) keep the entered values.
   */
  private async withLatestReleaseValues<
    T extends {
      id: string;
      latestReleaseId: string | null;
      analytes: Array<{
        code: string;
        numericValue: number | null;
        textValue: string | null;
        booleanValue: boolean | null;
        selectValue: string | null;
      }>;
    }
  >(reportTests: T[]): Promise<T[]> {
    const released = reportTests.filter((rt) => rt.latestReleaseId);
    if (released.length === 0) return reportTests;

    const releaseTests = await this.prisma.resultReportReleaseTest.findMany({
      where: {
        sourceReportTestId: { in: released.map((rt) => rt.id) },
        releaseId: { in: released.map((rt) => rt.latestReleaseId as string) },
      },
      select: {
        releaseId: true,
        sourceReportTestId: true,
        analytes: {
          select: {
            code: true,
            numericValue: true,
            textValue: true,
            booleanValue: true,
            selectValue: true,
          },
        },
      },
    });
    const latestByReportTest = new Map(
      releaseTests.map((rt) => [`${rt.sourceReportTestId}:${rt.releaseId}`, rt])
    );

    return reportTests.map((rt) => {
      const latest = latestByReportTest.get(`${rt.id}:${rt.latestReleaseId}`);
      if (!latest) return rt;
      const byCode = new Map(latest.analytes.map((a) => [a.code, a]));
      return {
        ...rt,
        analytes: rt.analytes.map((a) => {
          const r = byCode.get(a.code);
          return r
            ? {
                ...a,
                numericValue: r.numericValue,
                textValue: r.textValue,
                booleanValue: r.booleanValue,
                selectValue: r.selectValue,
              }
            : a;
        }),
      };
    });
  }

  private buildSections(
    version: {
      sections: Array<{ id: string; code?: string | null; name: string }>;
      analytes: Array<{
        id: string;
        code: string;
        name: string;
        technique?: string | null;
        valueType: string;
        unit?: string | null;
        options?: unknown;
        referenceRange?: unknown;
        isHeader: boolean;
        isRequired: boolean;
        formula?: string | null;
        sortOrder: number;
        sectionId?: string | null;
      }>;
    },
    savedByTemplateId: Map<
      string | null,
      {
        id: string;
        numericValue: number | null;
        textValue: string | null;
        booleanValue: boolean | null;
        selectValue: string | null;
      }
    >
  ) {
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
    return Array.from(sectionMap.values()).filter((s) => s.analytes.length > 0);
  }

  // GET /lab/ordered-tests/:testId/result-session
  // Returns the resolved template sections + existing saved values for this test.
  async getResultSession(testId: string, labTenantId: string) {
    const test = await this.prisma.orderedTest.findFirst({
      where: { id: testId, order: { labTenantId } },
      select: {
        id: true,
        catalogItemCode: true,
        templateDefinitionId: true,
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
    const ageWeeks = this.computeAgeWeeks(
      test.order.case.patientAge,
      test.order.case.patientAgeUnit
    );

    const { version } = await this.resolveTemplateOrThrow(
      test,
      labTenantId,
      species,
      ageWeeks
    );

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
            latestReleaseId: true,
            analytes: {
              select: {
                id: true,
                templateAnalyteId: true,
                code: true,
                numericValue: true,
                textValue: true,
                booleanValue: true,
                selectValue: true,
              },
            },
          },
        })
      : null;

    const [current] = reportTest
      ? await this.withLatestReleaseValues([reportTest])
      : [];
    const savedAnalytes = current?.analytes ?? [];
    const savedByTemplateId = new Map(
      savedAnalytes.map((a) => [a.templateAnalyteId, a])
    );

    const sections = this.buildSections(version, savedByTemplateId);

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
        templateDefinitionId: true,
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
    // Checked again under the report lock before writing
    this.assertEditable(
      [test],
      new Map([[test.id, releaseCheck?.status ?? 'DRAFT']])
    );

    const species = test.order.case.patientSpecies as PatientSpecies;
    const ageWeeks = this.computeAgeWeeks(
      test.order.case.patientAge,
      test.order.case.patientAgeUnit
    );

    const { def: templateDef, version } = await this.resolveTemplateOrThrow(
      test,
      labTenantId,
      species,
      ageWeeks
    );

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

    // All writes in one transaction under the report lock (created if
    // missing), re-checking the test wasn't released or sent to review.
    return this.prisma.$transaction(async (tx) => {
      const { report } = await this.lockReportAndRecheck(tx, test.order, [
        testId,
      ]);
      const reportId = report.id;

      // Get or create the ResultReportTest for this (report, orderedTest)
      let reportTest = await tx.resultReportTest.findUnique({
        where: {
          reportId_orderedTestId: {
            reportId,
            orderedTestId: testId,
          },
        },
        select: { id: true },
      });

      if (!reportTest) {
        reportTest = await tx.resultReportTest.create({
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
        await tx.resultReport.update({
          where: { id: reportId },
          data: { observations: observations ?? null },
        });
      }

      // Upsert each analyte value
      for (const input of analytes) {
        const templateAnalyte = analyteById.get(input.templateAnalyteId);
        if (!templateAnalyte || templateAnalyte.isHeader) continue;

        const existing = await tx.resultReportAnalyte.findFirst({
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
          await tx.resultReportAnalyte.update({
            where: { id: existing.id },
            data,
          });
        } else {
          await tx.resultReportAnalyte.create({
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
        const savedRows = await tx.resultReportAnalyte.findMany({
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
        const siblingRows = await tx.resultReportAnalyte.findMany({
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
          const existing = await tx.resultReportAnalyte.findFirst({
            where: { reportTestId: reportTest.id, templateAnalyteId: fa.id },
            select: { id: true },
          });

          if (existing) {
            await tx.resultReportAnalyte.update({
              where: { id: existing.id },
              data: { numericValue: value },
            });
          } else {
            await tx.resultReportAnalyte.create({
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
        await tx.orderedTest.update({
          where: { id: testId },
          data: {
            status: 'IN_PROGRESS',
            startedAt: new Date(),
            version: { increment: 1 },
          },
        });
        if (actorId && actorName) {
          await tx.timelineEvent.create({
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
    }, ENTRY_TX_OPTIONS);
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
        templateDefinitionId: true,
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
    const ageWeeks = this.computeAgeWeeks(
      test.order.case.patientAge,
      test.order.case.patientAgeUnit
    );

    const { version } = await this.resolveTemplateOrThrow(
      test,
      labTenantId,
      species,
      ageWeeks
    );

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

    const missingFields = this.validateRequiredFields(
      version.analytes,
      savedByTemplateId
    );
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

  /**
   * Save (and optionally submit) several tests of ONE order in one atomic
   * step. Every item is validated before anything is written; the writes run
   * in one transaction under the report lock, re-checking that no test was
   * released or sent to review meanwhile. Any failure — including a submit
   * validation error — rolls the whole batch back.
   */
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
    if (tests.length === 0) return { results: [] };
    const testIds = tests.map((t) => t.testId);
    if (new Set(testIds).size !== testIds.length) {
      throw new BadRequestException(
        'Each test can appear only once in a batch.'
      );
    }

    // 1. Every test must exist in this lab — none is silently skipped
    const orderedTests = await this.prisma.orderedTest.findMany({
      where: { id: { in: testIds }, order: { labTenantId } },
      select: {
        id: true,
        catalogItemCode: true,
        templateDefinitionId: true,
        catalogItemName: true,
        status: true,
        order: {
          select: {
            id: true,
            caseId: true,
            tenantId: true,
            resultReport: {
              select: {
                id: true,
                tests: {
                  where: { orderedTestId: { in: testIds } },
                  select: { orderedTestId: true, status: true },
                },
              },
            },
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
    const missing = testIds.filter((id) => !testMap.has(id));
    if (missing.length > 0) {
      throw new NotFoundException(
        `Ordered tests not found: ${missing.join(', ')}`
      );
    }

    // 2. One order per batch: the tests share its report, patient and
    // observations. Mixing orders would file results under the wrong report.
    const orderIds = new Set(orderedTests.map((t) => t.order.id));
    if (orderIds.size > 1) {
      throw new BadRequestException({
        code: 'BATCH_SPANS_ORDERS',
        message: 'A batch can only contain tests from one order.',
        orderIds: [...orderIds],
      });
    }
    const order = orderedTests[0].order;

    // 3. Status (checked again under the lock before writing)
    this.assertEditable(
      orderedTests,
      new Map(
        orderedTests
          .flatMap((t) => t.order.resultReport?.tests ?? [])
          .map((rt) => [rt.orderedTestId, rt.status])
      )
    );

    // 4. Templates, resolved for this order's patient
    const species = order.case.patientSpecies as PatientSpecies;
    const ageWeeks = this.computeAgeWeeks(
      order.case.patientAge,
      order.case.patientAgeUnit
    );
    const templateCache = new Map<
      string,
      Awaited<ReturnType<typeof this.templateVersionService.resolveTemplate>>
    >();
    await Promise.all(
      Array.from(
        new Map(orderedTests.map((t) => [this.templateKey(t), t])).entries()
      ).map(async ([key, t]) => {
        templateCache.set(
          key,
          await this.templateVersionService.resolveTemplateForTest(
            t,
            labTenantId,
            species,
            ageWeeks
          )
        );
      })
    );
    const versionOf = (ot: TemplateKeyed) =>
      templateCache.get(this.templateKey(ot))?.activeVersion ?? null;
    const noTemplate = orderedTests.filter((ot) => !versionOf(ot));
    if (noTemplate.length > 0) {
      throw new BadRequestException(
        `No active result template for: ${noTemplate
          .map((t) => t.catalogItemName ?? t.id)
          .join(', ')}`
      );
    }

    // 5. Values: known analytes of that template, no negative numbers
    const unknown: string[] = [];
    const negative: string[] = [];
    for (const entry of tests) {
      const ot = testMap.get(entry.testId)!;
      const analyteById = new Map(
        versionOf(ot)!.analytes.map((a) => [a.id, a])
      );
      for (const input of entry.analytes) {
        const analyte = analyteById.get(input.templateAnalyteId);
        if (!analyte) {
          unknown.push(
            `${ot.catalogItemName ?? ot.id}: ${input.templateAnalyteId}`
          );
        } else if (input.numericValue != null && input.numericValue < 0) {
          negative.push(`${ot.catalogItemName ?? ot.id}: ${analyte.name}`);
        }
      }
    }
    if (unknown.length > 0) {
      throw new BadRequestException(
        `Unknown analytes (the template may have changed — reload the page): ${unknown.join(
          ', '
        )}`
      );
    }
    if (negative.length > 0) {
      throw new BadRequestException(
        `Negative values are not allowed: ${negative.join(', ')}`
      );
    }

    // 6. All writes: one transaction under the report lock
    return this.prisma.$transaction(
      (tx) =>
        this.writeBatch(tx, {
          order,
          orderedTests,
          tests,
          // Every test has a template (checked above)
          versionOf: (ot) => versionOf(ot)!,
          submitAfterSave,
          actorId,
          actorName,
        }),
      ENTRY_TX_OPTIONS
    );
  }

  private async writeBatch(
    tx: Prisma.TransactionClient,
    input: {
      order: { id: string; caseId: string; tenantId: string };
      orderedTests: Array<{
        id: string;
        status: string;
        catalogItemName: string | null;
        catalogItemCode: string | null;
        templateDefinitionId: string | null;
      }>;
      tests: Parameters<ResultEntryService['batchSaveAndSubmit']>[1];
      versionOf: (ot: TemplateKeyed) => TemplateVersionForEntry;
      submitAfterSave: boolean;
      actorId: string;
      actorName: string;
    }
  ) {
    const {
      order,
      orderedTests,
      tests,
      versionOf,
      submitAfterSave,
      actorId,
      actorName,
    } = input;
    const testIds = orderedTests.map((t) => t.id);
    const testMap = new Map(orderedTests.map((t) => [t.id, t]));

    const { report, reportTests } = await this.lockReportAndRecheck(
      tx,
      order,
      testIds
    );
    const reportId = report.id;

    // Report-test rows for every test
    const reportTestByTestId = new Map(
      reportTests.map((rt) => [rt.orderedTestId, rt.id])
    );
    for (const ot of orderedTests) {
      if (reportTestByTestId.has(ot.id)) continue;
      const version = versionOf(ot);
      const rt = await tx.resultReportTest.create({
        data: {
          reportId,
          orderedTestId: ot.id,
          templateVersionId: version.id,
          templateDefinitionId: version.definitionId,
        },
        select: { id: true },
      });
      reportTestByTestId.set(ot.id, rt.id);
    }
    const reportTestIds = [...reportTestByTestId.values()];

    // Entered values
    const existing = await tx.resultReportAnalyte.findMany({
      where: { reportTestId: { in: reportTestIds } },
      select: { id: true, reportTestId: true, templateAnalyteId: true },
    });
    const existingByKey = new Map(
      existing.map((a) => [`${a.reportTestId}::${a.templateAnalyteId}`, a.id])
    );
    for (const entry of tests) {
      const ot = testMap.get(entry.testId)!;
      const version = versionOf(ot);
      const rtId = reportTestByTestId.get(ot.id)!;
      const analyteById = new Map(version.analytes.map((a) => [a.id, a]));
      const sectionNameById = new Map(
        version.sections.map((s) => [s.id, s.name])
      );
      for (const value of entry.analytes) {
        const analyte = analyteById.get(value.templateAnalyteId)!;
        if (analyte.isHeader) continue;
        const data = {
          numericValue: value.numericValue ?? null,
          textValue: value.textValue ?? null,
          booleanValue: value.booleanValue ?? null,
          selectValue: value.selectValue ?? null,
        };
        const id = existingByKey.get(`${rtId}::${analyte.id}`);
        if (id) {
          await tx.resultReportAnalyte.update({ where: { id }, data });
        } else {
          const created = await tx.resultReportAnalyte.create({
            data: {
              reportTestId: rtId,
              templateAnalyteId: analyte.id,
              code: analyte.code,
              name: analyte.name,
              technique: analyte.technique ?? null,
              unit: analyte.unit ?? null,
              valueType: analyte.valueType,
              sectionName: analyte.sectionId
                ? sectionNameById.get(analyte.sectionId) ?? null
                : null,
              sortOrder: analyte.sortOrder,
              isHeader: analyte.isHeader,
              formula: analyte.formula ?? null,
              ...data,
            },
            select: { id: true },
          });
          existingByKey.set(`${rtId}::${analyte.id}`, created.id);
        }
      }
    }

    // Observations live on the report (last one in the batch wins)
    const lastObs = [...tests]
      .reverse()
      .find((t) => t.observations !== undefined);
    if (lastObs?.observations !== undefined) {
      await tx.resultReport.update({
        where: { id: reportId },
        data: { observations: lastObs.observations ?? null },
      });
    }

    // Formulas: this batch's values first, then the report's other tests
    // (cross-test references such as the anion gap)
    const savedRows = await tx.resultReportAnalyte.findMany({
      where: { reportTest: { reportId } },
      select: { reportTestId: true, code: true, numericValue: true },
    });
    const savedByCode = new Map<string, number | null>();
    for (const r of savedRows.filter((r) =>
      reportTestIds.includes(r.reportTestId)
    )) {
      savedByCode.set(r.code, r.numericValue);
    }
    for (const r of savedRows) {
      if (!savedByCode.has(r.code)) savedByCode.set(r.code, r.numericValue);
    }
    for (const ot of orderedTests) {
      const version = versionOf(ot);
      const formulaAnalytes = version.analytes.filter(
        (a) => a.formula && !a.isHeader
      );
      if (formulaAnalytes.length === 0) continue;
      const rtId = reportTestByTestId.get(ot.id)!;
      const sectionNameById = new Map(
        version.sections.map((s) => [s.id, s.name])
      );
      const allForEval = version.analytes
        .filter((a) => !a.isHeader)
        .map((a) => ({
          code: a.code,
          formula: a.formula ?? null,
          numericValue: savedByCode.get(a.code) ?? null,
        }));
      const ownCodes = new Set(allForEval.map((a) => a.code));
      for (const [code, numericValue] of savedByCode) {
        if (!ownCodes.has(code)) {
          allForEval.push({ code, formula: null, numericValue });
        }
      }
      const computed = evaluateAllFormulas(allForEval);
      for (const fa of formulaAnalytes) {
        const numericValue = computed[fa.code] ?? null;
        const id = existingByKey.get(`${rtId}::${fa.id}`);
        if (id) {
          await tx.resultReportAnalyte.update({
            where: { id },
            data: { numericValue },
          });
        } else {
          const created = await tx.resultReportAnalyte.create({
            data: {
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
              numericValue,
            },
            select: { id: true },
          });
          existingByKey.set(`${rtId}::${fa.id}`, created.id);
        }
      }
    }

    // READY → IN_PROGRESS
    const now = new Date();
    for (const t of orderedTests.filter((t) => t.status === 'READY')) {
      await tx.orderedTest.update({
        where: { id: t.id },
        data: {
          status: 'IN_PROGRESS',
          startedAt: now,
          version: { increment: 1 },
        },
      });
      await tx.timelineEvent.create({
        data: {
          orderId: order.id,
          eventType: 'PROCESSING_STARTED',
          actorId,
          actorName,
          description: `${t.catalogItemName}: result entry started`,
          metadata: { orderedTestId: t.id },
        },
      });
    }

    const results = tests.map((entry) => ({
      testId: entry.testId,
      reportId,
      saved: entry.analytes.length,
      submitted: false,
    }));
    if (!submitAfterSave) return { results };

    // Submit: validate every test before changing any status. A failure
    // throws and rolls back the saves above too.
    const rows = await tx.resultReportAnalyte.findMany({
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
    const allCodes = new Set(savedRows.map((r) => r.code));
    // Already-entered tests are updates: saved again, not re-submitted
    const submittable = orderedTests.filter((t) =>
      ['READY', 'IN_PROGRESS'].includes(t.status)
    );
    const problems: string[] = [];
    for (const ot of submittable) {
      const version = versionOf(ot);
      const rtId = reportTestByTestId.get(ot.id)!;
      const savedByTemplateId = new Map(
        rows
          .filter((r) => r.reportTestId === rtId)
          .map((r) => [r.templateAnalyteId, r])
      );
      const missingFields = this.validateRequiredFields(
        version.analytes,
        savedByTemplateId
      );
      if (missingFields.length > 0) {
        problems.push(
          `Missing required fields for ${
            ot.catalogItemName
          }: ${missingFields.join(', ')}`
        );
      }
      for (const fa of version.analytes.filter(
        (a) => a.formula && !a.isHeader
      )) {
        const saved = savedByTemplateId.get(fa.id);
        if (saved && saved.numericValue !== null) continue;
        const refs =
          fa.formula!.match(/\[([^\]]+)\]/g)?.map((r) => r.slice(1, -1)) ?? [];
        if (refs.every((ref) => allCodes.has(ref))) {
          problems.push(
            `Formula could not be computed for ${ot.catalogItemName}: ${fa.name}`
          );
        }
      }
    }
    if (problems.length > 0) {
      throw new BadRequestException(problems.join('; '));
    }

    for (const t of submittable) {
      await tx.orderedTest.update({
        where: { id: t.id },
        data: {
          status: 'RESULTS_ENTERED',
          completedAt: now,
          version: { increment: 1 },
        },
      });
      await tx.timelineEvent.create({
        data: {
          orderId: order.id,
          eventType: 'RESULTS_COMPLETED',
          actorId,
          actorName,
          description: `${t.catalogItemName}: results entered`,
          metadata: { orderedTestId: t.id },
        },
      });
    }
    // A partially released report goes back to DRAFT for the new results
    if (submittable.length > 0 && report.status === 'RELEASED') {
      await tx.resultReport.update({
        where: { id: reportId },
        data: { status: 'DRAFT' },
      });
    }
    for (const r of results) {
      r.submitted = submittable.some((s) => s.id === r.testId);
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
        templateDefinitionId: true,
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

    // Resolve templates once per unique (catalogCode or manual pick, species, ageWeeks)
    const templateCache = new Map<
      string,
      Awaited<ReturnType<typeof this.templateVersionService.resolveTemplate>>
    >();
    const cacheKeys = new Map<
      string,
      {
        test: (typeof eligible)[number];
        species: PatientSpecies;
        ageWeeks: number | null;
      }
    >();
    for (const t of eligible) {
      const species = t.order.case.patientSpecies as PatientSpecies;
      const ageWeeks = this.computeAgeWeeks(
        t.order.case.patientAge,
        t.order.case.patientAgeUnit
      );
      const key = `${this.templateKey(t)}::${species}::${ageWeeks}`;
      if (!cacheKeys.has(key)) {
        cacheKeys.set(key, { test: t, species, ageWeeks });
      }
    }
    await Promise.all(
      Array.from(cacheKeys.entries()).map(
        async ([key, { test, species, ageWeeks }]) => {
          const tmpl = await this.templateVersionService.resolveTemplateForTest(
            test,
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
              latestReleaseId: true,
              analytes: {
                select: {
                  id: true,
                  templateAnalyteId: true,
                  code: true,
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
      (await this.withLatestReleaseValues(reportTests)).map((rt) => [
        rt.orderedTestId,
        rt,
      ])
    );

    return eligible.map((test) => {
      const species = test.order.case.patientSpecies as PatientSpecies;
      const ageWeeks = this.computeAgeWeeks(
        test.order.case.patientAge,
        test.order.case.patientAgeUnit
      );
      const key = `${this.templateKey(test)}::${species}::${ageWeeks}`;
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

      const sections = this.buildSections(version, savedByTemplateId);

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
