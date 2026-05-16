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
import type {
  ResultTemplateModel,
  ResultTemplateSectionModel,
  ResultTemplateAnalyteModel,
  ResultReportModel,
  ResultReportAnalyteModel,
  ReferenceRangeSnapshot,
  AiInterpretationModel,
  AiInterpretationFlaggedAnalyte,
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

const TEMPLATE_INCLUDE = {
  sections: {
    orderBy: { sortOrder: 'asc' as const },
    include: { analytes: { orderBy: { sortOrder: 'asc' as const } } },
  },
  analytes: { orderBy: { sortOrder: 'asc' as const } },
} satisfies Prisma.ResultTemplateInclude;

const REPORT_INCLUDE = {
  analytes: { orderBy: { sortOrder: 'asc' as const } },
} satisfies Prisma.ResultReportInclude;

// ---------------------------------------------------------------------------

@Injectable()
export class ResultsService {
  private readonly anthropic: Anthropic;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly ragService: RagService
  ) {
    this.anthropic = new Anthropic({
      apiKey: this.config.getOrThrow<string>('ANTHROPIC_API_KEY'),
    });
  }

  // ---------------------------------------------------------------------------
  // Template management (Biomet internal)
  // ---------------------------------------------------------------------------

  /**
   * Upsert a result template for a given catalog item + species.
   * If a template already exists for that pair, its sections and analytes are
   * fully replaced and the version is incremented.
   */
  async importTemplate(dto: ImportTemplateDto): Promise<ResultTemplateModel> {
    const catalogItem = await this.prisma.catalogItem.findUnique({
      where: { code: dto.catalogItemCode },
      select: { id: true },
    });
    if (!catalogItem) {
      throw new NotFoundException(
        `Catalog item with code "${dto.catalogItemCode}" not found.`
      );
    }

    const species = dto.species as unknown as PatientSpecies;
    const ageMinWeeks = dto.ageMinWeeks ?? null;
    const ageMaxWeeks = dto.ageMaxWeeks ?? null;

    const template = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.resultTemplate.findFirst({
        where: {
          catalogItemId: catalogItem.id,
          species,
          ageMinWeeks,
          ageMaxWeeks,
        },
        select: { id: true },
      });

      let templateId: string;

      if (existing) {
        // Replace sections + analytes atomically — analytes first (no cascade on sectionId)
        await tx.resultTemplateAnalyte.deleteMany({
          where: { templateId: existing.id },
        });
        await tx.resultTemplateSection.deleteMany({
          where: { templateId: existing.id },
        });
        await tx.resultTemplate.update({
          where: { id: existing.id },
          data: {
            title: dto.title,
            defaultObservations: dto.defaultObservations ?? null,
            version: { increment: 1 },
            isActive: true,
          },
        });
        templateId = existing.id;
      } else {
        const created = await tx.resultTemplate.create({
          data: {
            catalogItemId: catalogItem.id,
            species,
            ageMinWeeks,
            ageMaxWeeks,
            title: dto.title,
            defaultObservations: dto.defaultObservations ?? null,
          },
          select: { id: true },
        });
        templateId = created.id;
      }

      for (const sectionDto of dto.sections) {
        const section = await tx.resultTemplateSection.create({
          data: {
            templateId,
            name: sectionDto.name,
            sortOrder: sectionDto.sortOrder,
          },
          select: { id: true },
        });

        for (const analyteDto of sectionDto.analytes) {
          await tx.resultTemplateAnalyte.create({
            data: {
              templateId,
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

      return tx.resultTemplate.findUniqueOrThrow({
        where: { id: templateId },
        include: TEMPLATE_INCLUDE,
      });
    });

    return this.formatTemplate(template);
  }

  async findTemplates(): Promise<ResultTemplateModel[]> {
    const templates = await this.prisma.resultTemplate.findMany({
      where: { isActive: true },
      include: TEMPLATE_INCLUDE,
      orderBy: [{ species: 'asc' }, { title: 'asc' }],
    });
    return templates.map((t) => this.formatTemplate(t));
  }

  async findTemplate(id: string): Promise<ResultTemplateModel> {
    const template = await this.prisma.resultTemplate.findUnique({
      where: { id },
      include: TEMPLATE_INCLUDE,
    });
    if (!template) throw new NotFoundException('Result template not found.');
    return this.formatTemplate(template);
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

    // Expand packages → component TEST catalog item IDs.
    // A package has no template of its own; its components do.
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
        expandedIds.add(id); // already a TEST — keep as-is
      }
    }
    const catalogItemIds = Array.from(expandedIds);

    const templateRows = await this.prisma.resultTemplate.findMany({
      where: {
        catalogItemId: { in: catalogItemIds },
        species: { in: [species, PatientSpecies.ANY] },
        isActive: true,
      },
      include: TEMPLATE_INCLUDE,
      orderBy: [{ species: 'asc' }, { title: 'asc' }],
    });

    // Per catalog item: pick the best template.
    // Priority: (1) age-specific + species-specific > (2) age-specific + ANY >
    //           (3) age-agnostic + species-specific > (4) age-agnostic + ANY
    const templateByCatalogItem = new Map<
      string,
      (typeof templateRows)[number]
    >();
    for (const t of templateRows) {
      const ageMatches =
        patientAgeWeeks == null
          ? t.ageMinWeeks == null && t.ageMaxWeeks == null // no patient age → only agnostic
          : (t.ageMinWeeks == null || patientAgeWeeks >= t.ageMinWeeks) &&
            (t.ageMaxWeeks == null || patientAgeWeeks <= t.ageMaxWeeks);

      if (!ageMatches) continue;

      const existing = templateByCatalogItem.get(t.catalogItemId);
      if (!existing) {
        templateByCatalogItem.set(t.catalogItemId, t);
        continue;
      }

      const tScore = this.templateScore(t, species);
      const eScore = this.templateScore(existing, species);
      if (tScore > eScore) templateByCatalogItem.set(t.catalogItemId, t);
    }
    const templates = Array.from(templateByCatalogItem.values());

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
          templateId: templates[0].id,
          status: 'DRAFT',
        },
        select: { id: true },
      });

      const analytesToCreate: Prisma.ResultReportAnalyteCreateManyInput[] = [];

      for (const template of templates) {
        const sectionNameById = new Map(
          template.sections.map((s) => [s.id, s.name])
        );

        for (const analyte of template.analytes) {
          analytesToCreate.push({
            reportId: newReport.id,
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
      }

      if (analytesToCreate.length > 0) {
        await tx.resultReportAnalyte.createMany({ data: analytesToCreate });
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

    await this.prisma.$transaction(async (tx) => {
      await Promise.all(
        dto.analytes.map((a) =>
          tx.resultReportAnalyte.updateMany({
            where: { id: a.analyteId, reportId },
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
    if (report.status !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT reports can be released.');
    }

    const analytes = await this.prisma.resultReportAnalyte.findMany({
      where: { reportId },
      include: { templateAnalyte: { select: { referenceRange: true } } },
      orderBy: { sortOrder: 'asc' },
    });

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
      include: { analytes: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!report) throw new NotFoundException('Result report not found.');
    if (report.tenantId !== tenantId)
      throw new NotFoundException('Result report not found.');
    if (report.status !== 'RELEASED') {
      throw new BadRequestException(
        'AI interpretation is only available for released reports.'
      );
    }

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

    const analyteLines = report.analytes
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
    const flaggedForRag = report.analytes
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

  private templateScore(
    t: {
      species: PatientSpecies;
      ageMinWeeks: number | null;
      ageMaxWeeks: number | null;
    },
    patientSpecies: PatientSpecies
  ): number {
    const speciesScore = t.species === patientSpecies ? 2 : 0; // ANY = 0
    const ageScore = t.ageMinWeeks != null || t.ageMaxWeeks != null ? 1 : 0;
    return speciesScore + ageScore;
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
        max_tokens: 1400,
        system: [
          {
            type: 'text',
            text: INTERPRETATION_SYSTEM_PROMPT,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: userMessage }],
      });

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
    const mapAnalyte = (a: any): ResultTemplateAnalyteModel => ({
      id: a.id,
      templateId: a.templateId,
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

    const sections: ResultTemplateSectionModel[] = (raw.sections ?? []).map(
      (s: any) => ({
        id: s.id,
        templateId: raw.id,
        name: s.name,
        sortOrder: s.sortOrder,
        analytes: (s.analytes ?? []).map(mapAnalyte),
      })
    );

    return {
      id: raw.id,
      catalogItemId: raw.catalogItemId,
      species: raw.species as ResultTemplateModel['species'],
      ageMinWeeks: raw.ageMinWeeks ?? undefined,
      ageMaxWeeks: raw.ageMaxWeeks ?? undefined,
      title: raw.title,
      version: raw.version,
      isActive: raw.isActive,
      defaultObservations: raw.defaultObservations ?? undefined,
      sections,
      analytes: (raw.analytes ?? []).map(mapAnalyte),
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private formatReport(raw: any): ResultReportModel {
    return {
      id: raw.id,
      orderId: raw.orderId,
      caseId: raw.caseId,
      tenantId: raw.tenantId,
      templateId: raw.templateId,
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
      releasedAt: raw.releasedAt ?? undefined,
      releasedByUserId: raw.releasedByUserId ?? undefined,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
      analytes: (raw.analytes ?? []).map(
        (a: any): ResultReportAnalyteModel => ({
          id: a.id,
          reportId: a.reportId,
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
