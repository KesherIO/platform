import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  AnalyteValueType,
  CaseStatus,
  PatientSpecies,
  Prisma,
} from '@prisma/client';
import Anthropic from '@anthropic-ai/sdk';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RagService, RetrievedChunk } from '../rag/rag.service';
import { TemplateVersionService } from './template-version.service';
import {
  evaluateAllFormulas,
  validateTemplateFormulas,
} from '../lab/formula.util';
import { toStableCode } from './code-gen.util';
import type {
  ResultTemplateModel,
  ResultTemplateSectionModel,
  ResultTemplateAnalyteModel,
  ResultReportModel,
  ResultReportAnalyteModel,
  ReferenceRangeSnapshot,
  AiInterpretationModel,
  AiInterpretationFlaggedAnalyte,
  ClinicReleasedResultsModel,
} from '@vet-ai/shared-types';
import type {
  ImportTemplateDto,
  CreateReportDto,
  SaveAnalytesDto,
  ReleaseReportDto,
} from './dto/results.dto';
import type { OrderedItem } from '@vet-ai/shared-types';

const AI_INTERPRETATION_MODEL = 'claude-sonnet-4-6';
const AI_INTERPRETATION_PROMPT_VERSION = 'v2'; // v2: RAG-augmented prompt

const INTERPRETATION_SYSTEM_PROMPT = `You are a veterinary clinical pathology assistant embedded in a lab results platform.

Given a patient description, clinical symptoms, and structured lab results, return ONLY a valid JSON object — no markdown, no explanation — matching this exact schema:
{
  "summary": "string — 2 to 3 sentences giving a plain-language clinical overview of the results in context of the symptoms",
  "flaggedAnalytes": [
    {
      "code": "string — analyte code e.g. WBC",
      "name": "string — analyte display name",
      "value": "string — formatted value with unit e.g. '11.3 10^3/µL'",
      "flag": "H or L",
      "clinicalMeaning": "string — 1 to 2 sentences on the clinical significance of this specific abnormality"
    }
  ],
  "risks": ["string", ...],
  "suggestedNextSteps": ["string", ...],
  "disclaimer": "string"
}

Rules:
- flaggedAnalytes must include ONLY analytes with flag H or L — skip normal (N) values
- If all analytes are within reference range, return an empty flaggedAnalytes array
- risks: 2 to 4 concise clinical risks relevant to the patient, based on abnormal values and symptoms
- suggestedNextSteps: 2 to 4 actionable recommendations for the veterinarian
- disclaimer must always be: "This AI-generated interpretation is a clinical decision support tool only. It does not constitute a diagnosis. Always apply professional veterinary judgment."
- Tailor interpretation to the patient species — normal ranges and disease prevalence differ across species
- Write in a tone appropriate for a licensed veterinarian, not a pet owner
- CRITICAL: output must be a single, complete, valid JSON object — never truncate mid-object, never repeat keys, never add text outside the JSON`;

// ---------------------------------------------------------------------------
// Include shapes
// ---------------------------------------------------------------------------

const VERSION_INCLUDE = {
  sections: {
    orderBy: { sortOrder: 'asc' as const },
    include: { analytes: { orderBy: { sortOrder: 'asc' as const } } },
  },
  analytes: { orderBy: { sortOrder: 'asc' as const } },
} satisfies Prisma.ResultTemplateVersionInclude;

const REPORT_INCLUDE = {
  tests: {
    include: {
      analytes: { orderBy: { sortOrder: 'asc' as const } },
    },
  },
} satisfies Prisma.ResultReportInclude;

// ---------------------------------------------------------------------------

@Injectable()
export class ResultsService {
  private readonly anthropic: Anthropic;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly ragService: RagService,
    private readonly templateVersionService: TemplateVersionService
  ) {
    this.anthropic = new Anthropic({
      apiKey: this.config.getOrThrow<string>('ANTHROPIC_API_KEY'),
    });
  }

  // ---------------------------------------------------------------------------
  // Template management (KesherIO internal)
  // ---------------------------------------------------------------------------

  /**
   * Upsert a result template for a given catalog item + species.
   * If a template already exists for that pair, its sections and analytes are
   * fully replaced and the version is incremented.
   */
  async importTemplate(dto: ImportTemplateDto): Promise<ResultTemplateModel> {
    const catalogItem = await this.prisma.catalogItem.findFirst({
      where: { code: dto.catalogItemCode, labTenantId: dto.labTenantId },
      select: { id: true },
    });
    if (!catalogItem) {
      throw new NotFoundException(
        `Catalog item with code "${dto.catalogItemCode}" not found.`
      );
    }

    const species = dto.species as unknown as PatientSpecies;
    const ageMin = dto.ageMinWeeks ?? -1;
    const ageMax = dto.ageMaxWeeks ?? -1;

    if (dto.sections) {
      const formulaErrors = validateTemplateFormulas(
        dto.sections.map((s) => ({
          name: s.name,
          analytes: s.analytes.map((a) => ({
            code: a.code,
            name: a.name,
            formula: a.formula,
            isHeader: a.isHeader,
          })),
        }))
      );
      if (formulaErrors.length > 0) {
        throw new BadRequestException({
          message: 'Template contains invalid formulas and cannot be imported',
          formulaErrors,
        });
      }
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.resultTemplateDefinition.findUnique({
        where: {
          catalogItemCode_species_ageMinWeeks_ageMaxWeeks_ownerKey: {
            catalogItemCode: dto.catalogItemCode,
            species,
            ageMinWeeks: ageMin,
            ageMaxWeeks: ageMax,
            ownerKey: 'platform',
          },
        },
        select: { id: true, activeVersionId: true },
      });

      let definitionId: string;

      if (existing) {
        definitionId = existing.id;

        if (existing.activeVersionId) {
          await tx.resultTemplateVersion.update({
            where: { id: existing.activeVersionId },
            data: { status: 'ARCHIVED' },
          });
        }
      } else {
        const created = await tx.resultTemplateDefinition.create({
          data: {
            catalogItemCode: dto.catalogItemCode,
            species,
            ageMinWeeks: ageMin,
            ageMaxWeeks: ageMax,
            scope: 'PLATFORM',
            ownerKey: 'platform',
          },
          select: { id: true },
        });
        definitionId = created.id;
      }

      const maxVersion = await tx.resultTemplateVersion.aggregate({
        where: { definitionId },
        _max: { version: true },
      });
      const nextVersion = (maxVersion._max.version ?? 0) + 1;

      const version = await tx.resultTemplateVersion.create({
        data: {
          definitionId,
          version: nextVersion,
          title: dto.title,
          status: 'PUBLISHED',
          publishedAt: new Date(),
          defaultObservations: dto.defaultObservations ?? null,
          observationPhrases: dto.observationPhrases
            ? (dto.observationPhrases as unknown as Prisma.InputJsonValue)
            : undefined,
        },
        select: { id: true },
      });

      // Generate missing section codes before validating phrase references
      const existingCodes: string[] = dto.sections
        .filter((s) => s.code)
        .map((s) => s.code!);
      const sectionCodeMap = new Map<number, string | null>();
      const sectionCodeSet = new Set<string>();

      for (let i = 0; i < dto.sections.length; i++) {
        const sectionDto = dto.sections[i];
        let code = sectionDto.code ?? null;
        if (!code && sectionDto.name.trim()) {
          code = toStableCode(sectionDto.name, existingCodes, 'SEC');
          if (code) existingCodes.push(code);
        }
        if (code) {
          if (sectionCodeSet.has(code)) {
            throw new BadRequestException(
              `Duplicate section code '${code}' in this template`
            );
          }
          sectionCodeSet.add(code);
        }
        sectionCodeMap.set(i, code);
      }

      // Validate phrase sectionCode references against resolved codes
      if (dto.observationPhrases?.length) {
        const phraseCodes = new Set<string>();
        for (const phrase of dto.observationPhrases) {
          if (phraseCodes.has(phrase.code)) {
            throw new BadRequestException(
              `Duplicate phrase code: '${phrase.code}'`
            );
          }
          phraseCodes.add(phrase.code);

          if (!phrase.text.trim()) {
            throw new BadRequestException(
              `Phrase '${phrase.code}' has empty text after trimming`
            );
          }

          if (phrase.sectionCode && !sectionCodeSet.has(phrase.sectionCode)) {
            throw new BadRequestException(
              `Phrase '${phrase.code}' references non-existent section code '${phrase.sectionCode}'`
            );
          }
        }
      }

      for (let i = 0; i < dto.sections.length; i++) {
        const sectionDto = dto.sections[i];
        const code = sectionCodeMap.get(i) ?? null;
        const section = await (
          tx as PrismaService
        ).resultTemplateSection.create({
          data: {
            versionId: version.id,
            code,
            name: sectionDto.name,
            sortOrder: sectionDto.sortOrder,
          },
          select: { id: true },
        });

        for (const analyteDto of sectionDto.analytes) {
          await (tx as PrismaService).resultTemplateAnalyte.create({
            data: {
              versionId: version.id,
              sectionId: section.id,
              code: analyteDto.code,
              name: analyteDto.name,
              technique: analyteDto.technique ?? null,
              valueType: analyteDto.valueType as unknown as AnalyteValueType,
              unit: analyteDto.unit ?? null,
              options: analyteDto.options ?? [],
              sortOrder: analyteDto.sortOrder,
              isHeader: analyteDto.isHeader ?? false,
              formula: analyteDto.formula ?? null,
              referenceRange:
                (analyteDto.referenceRange as unknown as Prisma.InputJsonValue) ??
                Prisma.JsonNull,
            },
          });
        }
      }

      await tx.resultTemplateDefinition.update({
        where: { id: definitionId },
        data: { activeVersionId: version.id },
      });

      const definition = await tx.resultTemplateDefinition.findUniqueOrThrow({
        where: { id: definitionId },
        include: {
          activeVersion: { include: VERSION_INCLUDE },
        },
      });

      return definition;
    });

    return this.formatTemplate(result);
  }

  async findTemplates(): Promise<ResultTemplateModel[]> {
    const definitions = await this.prisma.resultTemplateDefinition.findMany({
      where: { activeVersionId: { not: null } },
      include: {
        activeVersion: { include: VERSION_INCLUDE },
      },
      orderBy: [{ species: 'asc' }, { catalogItemCode: 'asc' }],
    });
    return definitions.map((d) => this.formatTemplate(d));
  }

  async findTemplate(id: string): Promise<ResultTemplateModel> {
    const definition = await this.prisma.resultTemplateDefinition.findUnique({
      where: { id },
      include: {
        activeVersion: { include: VERSION_INCLUDE },
      },
    });
    if (!definition || !definition.activeVersion) {
      throw new NotFoundException('Result template not found.');
    }
    return this.formatTemplate(definition);
  }

  // ---------------------------------------------------------------------------
  // Report management (lab + clinic)
  // ---------------------------------------------------------------------------

  /**
   * Create a structured result report for an order.
   * Finds all matching ResultTemplates (one per ordered item + species), merges
   * their analytes into a single report, and snapshots the analyte metadata.
   * Throws if no templates are found or a report already exists for the order.
   */
  async createReport(dto: CreateReportDto): Promise<ResultReportModel> {
    const existing = await this.prisma.resultReport.findUnique({
      where: { orderId: dto.orderId },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        'A result report already exists for this order.'
      );
    }

    const order = await this.prisma.order.findUnique({
      where: { id: dto.orderId },
      include: {
        case: {
          select: {
            patientSpecies: true,
            patientAge: true,
            patientAgeUnit: true,
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found.');

    const species = order.case.patientSpecies;
    const rawItemIds = (order.orderedItems as unknown as OrderedItem[]).map(
      (i) => i.catalogItemId
    );

    const patientAgeWeeks = this.toAgeWeeks(
      order.case.patientAge,
      order.case.patientAgeUnit
    );

    const compositions = await this.prisma.catalogItemComposition.findMany({
      where: { packageId: { in: rawItemIds } },
      select: { packageId: true, componentId: true },
    });
    const expandedIds = new Set<string>();
    for (const id of rawItemIds) {
      const components = compositions.filter((c) => c.packageId === id);
      if (components.length > 0) {
        components.forEach((c) => expandedIds.add(c.componentId));
      } else {
        expandedIds.add(id);
      }
    }
    const catalogItemIds = Array.from(expandedIds);

    const catalogItems = await this.prisma.catalogItem.findMany({
      where: { id: { in: catalogItemIds } },
      select: { id: true, code: true },
    });

    const uniqueCodes = [
      ...new Set(
        catalogItems
          .map((c) => c.code)
          .filter((code): code is string => code != null)
      ),
    ];

    const resolvedTemplates = await Promise.all(
      uniqueCodes.map((code) =>
        this.templateVersionService.resolveTemplate(
          code,
          order.tenantId,
          species,
          patientAgeWeeks
        )
      )
    );

    const templates = resolvedTemplates.filter(
      (t): t is NonNullable<typeof t> => t != null && t.activeVersion != null
    );

    if (templates.length === 0) {
      throw new NotFoundException(
        `No active result template found for the ordered items with species ${species}.`
      );
    }

    const report = await this.prisma.$transaction(async (tx) => {
      const newReport = await tx.resultReport.create({
        data: {
          orderId: dto.orderId,
          caseId: order.caseId,
          tenantId: order.tenantId,
          status: 'DRAFT',
        },
        select: { id: true },
      });

      for (const template of templates) {
        const version = template.activeVersion!;
        const sectionNameById = new Map(
          version.sections.map((s) => [s.id, s.name])
        );

        const reportTest = await tx.resultReportTest.create({
          data: {
            reportId: newReport.id,
            templateVersionId: version.id,
            templateDefinitionId: template.id,
          },
          select: { id: true },
        });

        const analytesToCreate: Prisma.ResultReportAnalyteCreateManyInput[] =
          [];
        for (const analyte of version.analytes) {
          analytesToCreate.push({
            reportTestId: reportTest.id,
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
          });
        }

        if (analytesToCreate.length > 0) {
          await tx.resultReportAnalyte.createMany({ data: analytesToCreate });
        }
      }

      return tx.resultReport.findUniqueOrThrow({
        where: { id: newReport.id },
        include: REPORT_INCLUDE,
      });
    });

    return this.formatReport(report);
  }

  async findReport(reportId: string): Promise<ResultReportModel> {
    const report = await this.prisma.resultReport.findUnique({
      where: { id: reportId },
      include: REPORT_INCLUDE,
    });
    if (!report) throw new NotFoundException('Result report not found.');
    return this.formatReport(report);
  }

  async findReportByOrderId(
    tenantId: string,
    requisitionNumber: string
  ): Promise<ResultReportModel> {
    const order = await this.prisma.order.findFirst({
      where: { requisitionNumber, tenantId },
      select: { id: true },
    });
    if (!order) throw new NotFoundException('Order not found.');

    const report = await this.prisma.resultReport.findFirst({
      where: { orderId: order.id, tenantId },
      include: REPORT_INCLUDE,
    });
    if (!report) throw new NotFoundException('Result report not found.');
    return this.formatReport(report);
  }

  async findReportByOrder(
    tenantId: string,
    orderId: string
  ): Promise<ResultReportModel> {
    const report = await this.prisma.resultReport.findFirst({
      where: { orderId, tenantId },
      include: REPORT_INCLUDE,
    });
    if (!report) throw new NotFoundException('Result report not found.');
    return this.formatReport(report);
  }

  /**
   * Batch-save analyte values on a DRAFT report.
   * Only updates provided analytes; omitted analytes are left unchanged.
   */
  async saveAnalytes(
    reportId: string,
    dto: SaveAnalytesDto
  ): Promise<ResultReportModel> {
    const report = await this.prisma.resultReport.findUnique({
      where: { id: reportId },
      select: { id: true, status: true },
    });
    if (!report) throw new NotFoundException('Result report not found.');
    if (report.status !== 'DRAFT') {
      throw new BadRequestException(
        'Analyte values can only be updated on DRAFT reports.'
      );
    }

    const reportTestIds = await this.prisma.resultReportTest.findMany({
      where: { reportId },
      select: { id: true },
    });
    const testIds = reportTestIds.map((rt) => rt.id);

    await this.prisma.$transaction(async (tx) => {
      await Promise.all(
        dto.analytes.map((a) =>
          tx.resultReportAnalyte.updateMany({
            where: { id: a.analyteId, reportTestId: { in: testIds } },
            data: {
              numericValue: a.numericValue ?? null,
              textValue: a.textValue ?? null,
              booleanValue: a.booleanValue ?? null,
              selectValue: a.selectValue ?? null,
            },
          })
        )
      );
    });

    const updated = await this.prisma.resultReport.findUniqueOrThrow({
      where: { id: reportId },
      include: REPORT_INCLUDE,
    });
    return this.formatReport(updated);
  }

  /**
   * Release a DRAFT report — final and visible to the clinic.
   * Computes and freezes abnormal flags, snapshots reference ranges,
   * fills professional footer, and advances the case to COMPLETED.
   */
  async releaseReport(
    reportId: string,
    dto: ReleaseReportDto
  ): Promise<ResultReportModel> {
    const report = await this.prisma.resultReport.findUnique({
      where: { id: reportId },
      select: { id: true, status: true, caseId: true },
    });
    if (!report) throw new NotFoundException('Result report not found.');
    if (report.status !== 'DRAFT' && report.status !== 'IN_REVIEW') {
      throw new BadRequestException(
        'Only DRAFT or IN_REVIEW reports can be released.'
      );
    }

    const reportTests = await this.prisma.resultReportTest.findMany({
      where: { reportId },
      include: {
        analytes: {
          include: { templateAnalyte: { select: { referenceRange: true } } },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });
    const analytes = reportTests.flatMap((rt) => rt.analytes);

    // Recompute all formula analytes before flag computation
    for (const rt of reportTests) {
      const hasFormulas = rt.analytes.some((a) => a.formula && !a.isHeader);
      if (!hasFormulas) continue;

      const allForEval = rt.analytes
        .filter((a) => !a.isHeader)
        .map((a) => ({
          code: a.code,
          formula: a.formula ?? null,
          numericValue: a.numericValue ? Number(a.numericValue) : null,
        }));

      const computed = evaluateAllFormulas(allForEval);

      for (const a of rt.analytes) {
        if (!a.formula || a.isHeader) continue;
        const value = computed[a.code] ?? null;
        if (value !== null) {
          await this.prisma.resultReportAnalyte.update({
            where: { id: a.id },
            data: { numericValue: value },
          });
          // Update in-memory for subsequent flag computation
          (a as { numericValue: typeof value }).numericValue = value;
        }
      }
    }

    await this.prisma.$transaction(async (tx) => {
      // Compute flags and snapshot reference ranges for every non-header analyte
      await Promise.all(
        analytes
          .filter((a) => !a.isHeader)
          .map((a) => {
            const ref = a.templateAnalyte
              ?.referenceRange as ReferenceRangeSnapshot | null;
            const flag =
              a.valueType === 'NUMERIC' && a.numericValue != null
                ? this.computeFlag(ref, a.numericValue)
                : null;

            return tx.resultReportAnalyte.update({
              where: { id: a.id },
              data: {
                flag,
                referenceSnapshot:
                  (ref as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull,
              },
            });
          })
      );

      // Release the report and fill professional footer
      await tx.resultReport.update({
        where: { id: reportId },
        data: {
          status: 'RELEASED',
          observations: dto.observations ?? null,
          processedByName: dto.processedByName ?? null,
          processedByRole: dto.processedByRole ?? null,
          processedByCredentials: dto.processedByCredentials ?? null,
          approvedByName: dto.approvedByName ?? null,
          approvedByRole: dto.approvedByRole ?? null,
          approvedByCredentials: dto.approvedByCredentials ?? null,
          signatureUrl: dto.signatureUrl ?? null,
          releasedAt: new Date(),
        },
      });

      // Advance case to COMPLETED (terminal state)
      await tx.case.update({
        where: { id: report.caseId },
        data: { status: CaseStatus.COMPLETED },
      });
    });

    const released = await this.prisma.resultReport.findUniqueOrThrow({
      where: { id: reportId },
      include: REPORT_INCLUDE,
    });
    return this.formatReport(released);
  }

  // ---------------------------------------------------------------------------
  // AI Interpretation (clinic-facing)
  // ---------------------------------------------------------------------------

  /**
   * Returns the stored AI interpretation for a report, or generates, saves,
   * and returns a new one if none exists yet.
   * Structured so the inner generation logic can later be called from an
   * async event handler (e.g. on report release) without changing this method.
   */
  async findInterpretation(
    reportId: string,
    tenantId: string,
    lang: 'en' | 'es' = 'en'
  ): Promise<AiInterpretationModel | null> {
    const existing = await this.prisma.aiInterpretation.findUnique({
      where: { reportId_lang: { reportId, lang } },
    });
    if (!existing || existing.tenantId !== tenantId) return null;
    return this.formatInterpretation(existing);
  }

  async getOrCreateInterpretation(
    reportId: string,
    tenantId: string,
    userId?: string,
    lang: 'en' | 'es' = 'en'
  ): Promise<AiInterpretationModel> {
    const existing = await this.prisma.aiInterpretation.findUnique({
      where: { reportId_lang: { reportId, lang } },
    });
    if (existing && existing.tenantId === tenantId) {
      return this.formatInterpretation(existing);
    }

    const report = await this.prisma.resultReport.findUnique({
      where: { id: reportId },
      include: {
        tests: {
          include: {
            analytes: { orderBy: { sortOrder: 'asc' } },
          },
        },
      },
    });
    if (!report) throw new NotFoundException('Result report not found.');
    if (report.tenantId !== tenantId)
      throw new NotFoundException('Result report not found.');
    if (report.status !== 'RELEASED') {
      throw new BadRequestException(
        'AI interpretation is only available for released reports.'
      );
    }

    const allAnalytes = report.tests.flatMap((t) => t.analytes);

    const caseRow = await this.prisma.case.findUnique({
      where: { id: report.caseId },
      select: {
        patientName: true,
        patientSpecies: true,
        patientSex: true,
        patientBreed: true,
        patientAge: true,
        patientAgeUnit: true,
        patientWeight: true,
        symptoms: true,
      },
    });
    if (!caseRow) throw new NotFoundException('Case not found.');

    const patientLine = [
      `Species: ${caseRow.patientSpecies}`,
      caseRow.patientBreed ? `Breed: ${caseRow.patientBreed}` : null,
      caseRow.patientAge != null && caseRow.patientAgeUnit
        ? `Age: ${caseRow.patientAge} ${caseRow.patientAgeUnit.toLowerCase()}`
        : null,
      caseRow.patientWeight != null
        ? `Weight: ${caseRow.patientWeight} kg`
        : null,
      caseRow.patientSex ? `Sex: ${caseRow.patientSex}` : null,
    ]
      .filter(Boolean)
      .join(' | ');

    const analyteLines = allAnalytes
      .filter((a) => !a.isHeader)
      .map((a) => {
        const ref = a.referenceSnapshot as ReferenceRangeSnapshot | null;
        const valuePart =
          a.valueType === 'NUMERIC' && a.numericValue != null
            ? `${a.numericValue}${a.unit ? ' ' + a.unit : ''}`
            : a.textValue ??
              a.selectValue ??
              (a.booleanValue != null ? String(a.booleanValue) : '—');
        const flagPart = a.flag && a.flag !== 'N' ? ` [${a.flag}]` : '';
        const refPart = ref?.displayText ? ` (ref: ${ref.displayText})` : '';
        return `${a.code} | ${a.name}: ${valuePart}${flagPart}${refPart}`;
      })
      .join('\n');

    // RAG retrieval — build query from flagged analytes + symptoms + species
    const flaggedForRag = allAnalytes
      .filter((a) => !a.isHeader && (a.flag === 'H' || a.flag === 'L'))
      .map((a) => ({ code: a.code, flag: a.flag as 'H' | 'L' }));

    let retrievedChunks: RetrievedChunk[] = [];
    try {
      retrievedChunks = await this.ragService.retrieveRelevantChunks({
        species: caseRow.patientSpecies.toLowerCase(),
        symptoms: caseRow.symptoms,
        analytes: flaggedForRag,
      });
    } catch (err) {
      console.warn('[RAG] Retrieval failed — proceeding without context:', err);
    }

    const ragContextBlock =
      retrievedChunks.length > 0
        ? [
            '--- Relevant clinical context from veterinary knowledge base ---',
            ...retrievedChunks.map(
              (c, i) =>
                `[${i + 1}] ${c.documentTitle} — ${c.section}\n${c.content}`
            ),
            '---',
          ].join('\n\n')
        : null;

    const languageInstruction =
      lang === 'es'
        ? 'Respond entirely in Spanish.'
        : 'Respond entirely in English.';

    const userMessage = [
      ragContextBlock,
      `Patient: ${caseRow.patientName}`,
      patientLine,
      `Symptoms: ${caseRow.symptoms ?? 'Not recorded'}`,
      '',
      'Lab results:',
      analyteLines,
      '',
      languageInstruction,
    ]
      .filter(Boolean)
      .join('\n');

    const parsed = await this.callInterpretationAi(userMessage);

    const saved = await this.prisma.aiInterpretation.create({
      data: {
        reportId,
        lang,
        caseId: report.caseId,
        tenantId,
        model: AI_INTERPRETATION_MODEL,
        promptVersion: AI_INTERPRETATION_PROMPT_VERSION,
        summary: parsed.summary ?? '',
        flaggedAnalytes: (parsed.flaggedAnalytes ??
          []) as unknown as Prisma.InputJsonValue,
        risks: (parsed.risks ?? []) as unknown as Prisma.InputJsonValue,
        suggestedNextSteps: (parsed.suggestedNextSteps ??
          []) as unknown as Prisma.InputJsonValue,
        disclaimer: parsed.disclaimer ?? '',
        generatedByUserId: userId ?? null,
        retrievedChunkIds: retrievedChunks.map((c) => c.id),
      },
    });

    return this.formatInterpretation(saved);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private toAgeWeeks(age: number | null, unit: string | null): number | null {
    if (age == null || unit == null) return null;
    switch (unit) {
      case 'DAYS':
        return age / 7;
      case 'WEEKS':
        return age;
      case 'MONTHS':
        return age * 4.33;
      case 'YEARS':
        return age * 52;
      default:
        return null;
    }
  }

  private computeFlag(
    ref: ReferenceRangeSnapshot | null,
    value: number
  ): string | null {
    if (!ref || (ref.min == null && ref.max == null)) return null;
    if (ref.min != null && value < ref.min) return 'L';
    if (ref.max != null && value > ref.max) return 'H';
    return 'N';
  }

  private async callInterpretationAi(userMessage: string): Promise<{
    summary: string;
    flaggedAnalytes: AiInterpretationFlaggedAnalyte[];
    risks: string[];
    suggestedNextSteps: string[];
    disclaimer: string;
  }> {
    const MAX_ATTEMPTS = 2;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const response = await this.anthropic.messages.create({
        model: AI_INTERPRETATION_MODEL,
        max_tokens: 4096,
        system: [
          {
            type: 'text',
            text: INTERPRETATION_SYSTEM_PROMPT,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: userMessage }],
      });

      if (response.stop_reason === 'max_tokens') {
        console.warn(
          `[AI Interpretation] Attempt ${attempt}/${MAX_ATTEMPTS} hit max_tokens limit.`
        );
        if (attempt === MAX_ATTEMPTS) {
          throw new InternalServerErrorException(
            'AI interpretation response was truncated.'
          );
        }
        continue;
      }

      const text =
        response.content[0].type === 'text' ? response.content[0].text : '';
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      const jsonSlice =
        start !== -1 && end > start ? text.slice(start, end + 1) : text;

      try {
        return JSON.parse(jsonSlice);
      } catch {
        console.warn(
          `[AI Interpretation] Parse attempt ${attempt}/${MAX_ATTEMPTS} failed. Raw response:\n${text}`
        );
        if (attempt === MAX_ATTEMPTS) {
          throw new InternalServerErrorException(
            'AI interpretation returned malformed JSON.'
          );
        }
      }
    }

    // unreachable — loop always throws or returns
    throw new InternalServerErrorException('AI interpretation failed.');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private formatInterpretation(raw: any): AiInterpretationModel {
    return {
      id: raw.id,
      reportId: raw.reportId,
      caseId: raw.caseId,
      tenantId: raw.tenantId,
      model: raw.model,
      promptVersion: raw.promptVersion,
      summary: raw.summary,
      flaggedAnalytes: (raw.flaggedAnalytes ??
        []) as AiInterpretationFlaggedAnalyte[],
      risks: (raw.risks ?? []) as string[],
      suggestedNextSteps: (raw.suggestedNextSteps ?? []) as string[],
      disclaimer: raw.disclaimer,
      generatedByUserId: raw.generatedByUserId ?? undefined,
      retrievedChunkIds: (raw.retrievedChunkIds ?? []) as string[],
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private formatTemplate(raw: any): ResultTemplateModel {
    const version = raw.activeVersion;
    if (!version) {
      return {
        id: raw.id,
        catalogItemCode: raw.catalogItemCode,
        species: raw.species,
        title: 'No active version',
        version: 0,
        isActive: false,
        sections: [],
        analytes: [],
      };
    }

    const mapAnalyte = (a: any): ResultTemplateAnalyteModel => ({
      id: a.id,
      versionId: a.versionId,
      sectionId: a.sectionId ?? undefined,
      code: a.code,
      name: a.name,
      technique: a.technique ?? undefined,
      valueType: a.valueType as ResultTemplateAnalyteModel['valueType'],
      unit: a.unit ?? undefined,
      options: a.options,
      sortOrder: a.sortOrder,
      isHeader: a.isHeader,
      formula: a.formula ?? undefined,
      referenceRange:
        (a.referenceRange as unknown as ReferenceRangeSnapshot) ?? undefined,
    });

    const sections: ResultTemplateSectionModel[] = (version.sections ?? []).map(
      (s: any) => ({
        id: s.id,
        versionId: version.id,
        code: s.code ?? undefined,
        name: s.name,
        sortOrder: s.sortOrder,
        analytes: (s.analytes ?? []).map(mapAnalyte),
      })
    );

    return {
      id: raw.id,
      catalogItemCode: raw.catalogItemCode,
      species: raw.species as ResultTemplateModel['species'],
      ageMinWeeks: raw.ageMinWeeks === -1 ? undefined : raw.ageMinWeeks,
      ageMaxWeeks: raw.ageMaxWeeks === -1 ? undefined : raw.ageMaxWeeks,
      title: version.title,
      version: version.version,
      isActive: version.status === 'PUBLISHED',
      defaultObservations: version.defaultObservations ?? undefined,
      observationPhrases: version.observationPhrases
        ? (version.observationPhrases as unknown as ResultTemplateModel['observationPhrases'])
        : undefined,
      sections,
      analytes: (version.analytes ?? []).map(mapAnalyte),
    };
  }

  // ---------------------------------------------------------------------------
  // Clinic-facing released results — only RELEASED data from immutable snapshots
  // ---------------------------------------------------------------------------

  async findReleasedResultsByOrder(
    tenantId: string,
    requisitionNumber: string
  ): Promise<ClinicReleasedResultsModel> {
    const order = await this.prisma.order.findFirst({
      where: { requisitionNumber, tenantId },
      select: { id: true, caseId: true, labTenantId: true },
    });
    if (!order) throw new NotFoundException('Order not found.');

    const report = await this.prisma.resultReport.findFirst({
      where: { orderId: order.id, tenantId },
      select: { id: true },
    });
    if (!report) throw new NotFoundException('Result report not found.');

    const allReportTests = await this.prisma.resultReportTest.findMany({
      where: { reportId: report.id },
      select: {
        id: true,
        status: true,
        latestReleaseId: true,
        orderedTest: {
          select: {
            catalogItemName: true,
            department: true,
            catalogItemId: true,
          },
        },
      },
    });

    const releasedTests = allReportTests.filter(
      (t) => t.status === 'RELEASED' && t.latestReleaseId
    );
    const pendingTests = allReportTests.filter((t) => t.status !== 'RELEASED');

    if (releasedTests.length === 0) {
      return {
        reportId: report.id,
        orderId: order.id,
        caseId: order.caseId,
        releaseStatus: 'NO_RESULTS',
        releasedTests: [],
        pendingTestNames: pendingTests.map(
          (t) => t.orderedTest?.catalogItemName ?? 'Unknown'
        ),
        latestReleasedAt: null,
      };
    }

    const releaseTestMap = new Map<string, string>();
    for (const rt of releasedTests) {
      releaseTestMap.set(rt.id, rt.latestReleaseId!);
    }

    const snapshotTests = await this.prisma.resultReportReleaseTest.findMany({
      where: {
        sourceReportTestId: { in: releasedTests.map((rt) => rt.id) },
        releaseId: { in: Array.from(releaseTestMap.values()) },
      },
      include: {
        analytes: { orderBy: { sortOrder: 'asc' } },
        release: {
          select: {
            releaseType: true,
            releasedAt: true,
            signerName: true,
            signerTitle: true,
            signerSpecialty: true,
            signerUniversity: true,
            signerRegistrationNumber: true,
            signerSignatureUrl: true,
            analystName: true,
            analystTitle: true,
            analystSpecialty: true,
            analystUniversity: true,
            analystRegistrationNumber: true,
            analystSignatureUrl: true,
            reportDisclaimer: true,
          },
        },
      },
    });

    const latestByTest = new Map<string, (typeof snapshotTests)[0]>();
    for (const st of snapshotTests) {
      if (releaseTestMap.get(st.sourceReportTestId) === st.releaseId) {
        latestByTest.set(st.sourceReportTestId, st);
      }
    }

    // Fallback department: OrderedTest.department → LabTestConfiguration.department
    const catalogItemIds = [
      ...new Set(
        allReportTests
          .map((rt) => rt.orderedTest?.catalogItemId)
          .filter((id): id is string => !!id)
      ),
    ];
    const labConfigs =
      catalogItemIds.length && order.labTenantId
        ? await this.prisma.labTestConfiguration.findMany({
            where: {
              catalogItemId: { in: catalogItemIds },
              labTenantId: order.labTenantId,
            },
            select: { catalogItemId: true, department: true },
          })
        : [];
    const configDeptMap = new Map<string, string>();
    for (const lc of labConfigs) {
      configDeptMap.set(lc.catalogItemId, lc.department);
    }

    const deptFallback = new Map<string, string | null>();
    for (const rt of allReportTests) {
      const dept =
        rt.orderedTest?.department ??
        (rt.orderedTest?.catalogItemId
          ? configDeptMap.get(rt.orderedTest.catalogItemId) ?? null
          : null);
      deptFallback.set(rt.id, dept);
    }

    const tests = Array.from(latestByTest.values())
      .sort((a, b) => a.catalogItemName.localeCompare(b.catalogItemName))
      .map((rt) => ({
        testName: rt.catalogItemName ?? '',
        catalogItemCode: rt.catalogItemCode,
        department:
          rt.department ?? deptFallback.get(rt.sourceReportTestId) ?? null,
        releaseType: rt.release.releaseType,
        releasedAt: rt.release.releasedAt.toISOString(),
        signerName: rt.release.signerName,
        signerTitle: rt.release.signerTitle ?? undefined,
        signerSpecialty: rt.release.signerSpecialty ?? undefined,
        signerUniversity: rt.release.signerUniversity ?? undefined,
        signerRegistrationNumber:
          rt.release.signerRegistrationNumber ?? undefined,
        signerSignatureUrl: rt.release.signerSignatureUrl ?? undefined,
        analystName: rt.release.analystName ?? undefined,
        analystTitle: rt.release.analystTitle ?? undefined,
        analystSpecialty: rt.release.analystSpecialty ?? undefined,
        analystUniversity: rt.release.analystUniversity ?? undefined,
        analystRegistrationNumber:
          rt.release.analystRegistrationNumber ?? undefined,
        analystSignatureUrl: rt.release.analystSignatureUrl ?? undefined,
        reportDisclaimer: rt.release.reportDisclaimer ?? undefined,
        observations: rt.observations ?? undefined,
        analytes: rt.analytes.map(
          (a): ResultReportAnalyteModel => ({
            id: a.id,
            reportTestId: rt.sourceReportTestId,
            code: a.code,
            name: a.name,
            technique: a.technique ?? undefined,
            unit: a.unit ?? undefined,
            valueType: a.valueType as ResultReportAnalyteModel['valueType'],
            sectionName: a.sectionName ?? undefined,
            sortOrder: a.sortOrder,
            isHeader: a.isHeader,
            formula: a.formula ?? undefined,
            numericValue: a.numericValue ? Number(a.numericValue) : undefined,
            textValue: a.textValue ?? undefined,
            booleanValue: a.booleanValue ?? undefined,
            selectValue: a.selectValue ?? undefined,
            flag: (a.flag as ResultReportAnalyteModel['flag']) ?? undefined,
            referenceSnapshot:
              (a.referenceSnapshot as unknown as ReferenceRangeSnapshot) ??
              undefined,
          })
        ),
      }));

    const releaseStatus =
      pendingTests.length === 0 ? 'ALL_RELEASED' : 'PARTIAL_RESULTS';

    const latestDate = tests.reduce<string | null>((max, t) => {
      if (!max || t.releasedAt > max) return t.releasedAt;
      return max;
    }, null);

    return {
      reportId: report.id,
      orderId: order.id,
      caseId: order.caseId,
      releaseStatus,
      releasedTests: tests,
      pendingTestNames: pendingTests.map(
        (t) => t.orderedTest?.catalogItemName ?? 'Unknown'
      ),
      latestReleasedAt: latestDate,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private formatReport(raw: any): ResultReportModel {
    const allAnalytes = (raw.tests ?? []).flatMap((t: any) => t.analytes ?? []);

    return {
      id: raw.id,
      orderId: raw.orderId,
      caseId: raw.caseId,
      tenantId: raw.tenantId,
      status: raw.status as ResultReportModel['status'],
      observations: raw.observations ?? undefined,
      processedByName: raw.processedByName ?? undefined,
      processedByRole: raw.processedByRole ?? undefined,
      processedByCredentials: raw.processedByCredentials ?? undefined,
      approvedByName: raw.approvedByName ?? undefined,
      approvedByRole: raw.approvedByRole ?? undefined,
      approvedByCredentials: raw.approvedByCredentials ?? undefined,
      signatureUrl: raw.signatureUrl ?? undefined,
      pdfUrl: raw.pdfUrl ?? undefined,
      submittedForReviewAt: raw.submittedForReviewAt ?? undefined,
      reviewedAt: raw.reviewedAt ?? undefined,
      reviewNotes: raw.reviewNotes ?? undefined,
      correctionNotes: raw.correctionNotes ?? undefined,
      reviewedBySignerId: raw.reviewedBySignerId ?? undefined,
      releasedAt: raw.releasedAt ?? undefined,
      releasedByUserId: raw.releasedByUserId ?? undefined,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
      analytes: allAnalytes.map(
        (a: any): ResultReportAnalyteModel => ({
          id: a.id,
          reportTestId: a.reportTestId,
          templateAnalyteId: a.templateAnalyteId ?? undefined,
          code: a.code,
          name: a.name,
          technique: a.technique ?? undefined,
          unit: a.unit ?? undefined,
          valueType: a.valueType as ResultReportAnalyteModel['valueType'],
          sectionName: a.sectionName ?? undefined,
          sortOrder: a.sortOrder,
          isHeader: a.isHeader,
          formula: a.formula ?? undefined,
          numericValue: a.numericValue ?? undefined,
          textValue: a.textValue ?? undefined,
          booleanValue: a.booleanValue ?? undefined,
          selectValue: a.selectValue ?? undefined,
          flag: (a.flag as ResultReportAnalyteModel['flag']) ?? undefined,
          referenceSnapshot:
            (a.referenceSnapshot as unknown as ReferenceRangeSnapshot) ??
            undefined,
        })
      ),
    };
  }
}
