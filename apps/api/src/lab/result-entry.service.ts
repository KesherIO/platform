import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TemplateVersionService } from '../results/template-version.service';
import { PatientSpecies, AgeUnit } from '@prisma/client';
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
      if (analyte.isHeader || analyte.formula) continue;
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

    const computed = evaluateAllFormulas(allForEval);
    const sectionNameById = new Map(
      version.sections.map((s) => [s.id, s.name])
    );

    const failedFormulas: string[] = [];
    const formulaAnalytes = version.analytes.filter(
      (a) => a.formula && !a.isHeader
    );
    for (const fa of formulaAnalytes) {
      const value = computed[fa.code] ?? null;
      if (value === null) {
        failedFormulas.push(fa.name);
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
}
