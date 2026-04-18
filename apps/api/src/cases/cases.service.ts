import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { CaseStatus, PatientSex, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogItemModel } from '@vet-ai/shared-types';
import { TriageService } from '../triage/triage.service';
import {
  CreateCaseDto,
  UpdatePatientInfoDto,
  AddSymptomsDto,
  SelectCatalogItemsDto,
  SendOrderDto,
  UploadResultsDto,
} from './dto/cases.dto';

// ---------------------------------------------------------------------------
// Status sets — used in guard assertions throughout this service
// ---------------------------------------------------------------------------

/** Statuses where patient info and test selection are still mutable. */
const MUTABLE_STATUSES = [CaseStatus.OPEN, CaseStatus.TRIAGED];

/** Statuses from which a case may be cancelled. */
const CANCELLABLE_STATUSES = [
  CaseStatus.OPEN,
  CaseStatus.TRIAGED,
  CaseStatus.ORDERED,
];

// ---------------------------------------------------------------------------
// Include shape — reused for findOne and selectCatalogItems
// ---------------------------------------------------------------------------

const CASE_INCLUDE = {
  selectedCatalogItems: {
    include: {
      catalogItem: {
        include: {
          components: { include: { component: true } },
        },
      },
    },
  },
  order: { select: { requisitionNumber: true, status: true } },
} satisfies Prisma.CaseInclude;

// ---------------------------------------------------------------------------

@Injectable()
export class CasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly triageService: TriageService
  ) {}

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  async findAll(tenantId: string, _userId: string) {
    return this.prisma.case.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(tenantId: string, id: string) {
    const raw = await this.prisma.case.findFirst({
      where: { id, tenantId },
      include: CASE_INCLUDE,
    });
    if (!raw) throw new NotFoundException('Case not found.');
    return this.formatCase(raw);
  }

  // ---------------------------------------------------------------------------
  // Mutations — create
  // ---------------------------------------------------------------------------

  async createCase(tenantId: string, userId: string, body: CreateCaseDto) {
    return this.prisma.case.create({
      data: {
        tenantId,
        createdByUserId: userId,
        status: CaseStatus.OPEN,
        patientName: body.patientName,
        patientSpecies: body.patientSpecies,
        patientSex: body.patientSex ?? null,
        patientBreed: body.patientBreed ?? null,
        patientDateOfBirth: body.patientDateOfBirth
          ? new Date(body.patientDateOfBirth)
          : null,
        patientAge: body.patientAge ?? null,
        patientAgeUnit: body.patientAgeUnit ?? null,
        patientWeight: body.patientWeight ?? null,
        ownerName: body.ownerName,
        ownerPhone: body.ownerPhone ?? null,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Mutations — patient info & catalog selection (status-gated, no transition)
  // ---------------------------------------------------------------------------

  /**
   * Partially update patient and owner fields.
   * Only provided fields are written — undefined keys are skipped entirely.
   * Allowed in: OPEN, TRIAGED.
   */
  async updatePatientInfo(
    tenantId: string,
    id: string,
    body: UpdatePatientInfoDto
  ) {
    const c = await this.fetchCase(tenantId, id);
    this.assertStatus(
      c,
      MUTABLE_STATUSES,
      'Patient info can only be updated in OPEN or TRIAGED status.'
    );

    return this.prisma.case.update({
      where: { id },
      data: {
        ...(body.patientName !== undefined && {
          patientName: body.patientName,
        }),
        ...(body.patientSpecies !== undefined && {
          patientSpecies: body.patientSpecies,
        }),
        ...(body.patientSex !== undefined && {
          patientSex: body.patientSex as PatientSex,
        }),
        ...(body.patientBreed !== undefined && {
          patientBreed: body.patientBreed,
        }),
        ...(body.patientDateOfBirth !== undefined && {
          patientDateOfBirth: body.patientDateOfBirth
            ? new Date(body.patientDateOfBirth)
            : null,
        }),
        ...(body.patientAge !== undefined && { patientAge: body.patientAge }),
        ...(body.patientAgeUnit !== undefined && {
          patientAgeUnit: body.patientAgeUnit,
        }),
        ...(body.patientWeight !== undefined && {
          patientWeight: body.patientWeight,
        }),
        ...(body.ownerName !== undefined && { ownerName: body.ownerName }),
        ...(body.ownerPhone !== undefined && { ownerPhone: body.ownerPhone }),
      },
    });
  }

  /**
   * Save the free-text symptom description entered by the vet.
   * Allowed in: OPEN only. Symptoms cannot be changed after AI triage runs.
   */
  async addSymptoms(tenantId: string, id: string, body: AddSymptomsDto) {
    const c = await this.fetchCase(tenantId, id);
    this.assertStatus(
      c,
      [CaseStatus.OPEN],
      'Symptoms can only be saved in OPEN status.'
    );

    return this.prisma.case.update({
      where: { id },
      data: { symptoms: body.symptoms },
    });
  }

  /**
   * Replace the entire selected catalog item list.
   * Validates all IDs belong to this tenant and are active.
   * Allowed in: OPEN, TRIAGED.
   */
  async selectCatalogItems(
    tenantId: string,
    id: string,
    body: SelectCatalogItemsDto
  ) {
    const c = await this.fetchCase(tenantId, id);
    this.assertStatus(
      c,
      MUTABLE_STATUSES,
      'Catalog items can only be selected in OPEN or TRIAGED status.'
    );

    // Validate all IDs exist in the global catalog and are active
    const validItems = await this.prisma.catalogItem.findMany({
      where: {
        id: { in: body.selectedCatalogItemIds },
        active: true,
      },
      select: { id: true },
    });

    if (validItems.length !== body.selectedCatalogItemIds.length) {
      throw new BadRequestException(
        'One or more catalog item IDs are invalid or inactive.'
      );
    }

    const raw = await this.prisma.$transaction(async (tx) => {
      await tx.caseCatalogItem.deleteMany({ where: { caseId: id } });
      await tx.caseCatalogItem.createMany({
        data: body.selectedCatalogItemIds.map((catalogItemId) => ({
          caseId: id,
          catalogItemId,
        })),
      });
      return tx.case.findFirstOrThrow({
        where: { id },
        include: CASE_INCLUDE,
      });
    });

    return this.formatCase(raw);
  }

  // ---------------------------------------------------------------------------
  // State transitions — each returns the updated Case resource
  // ---------------------------------------------------------------------------

  /**
   * Run AI triage on the stored symptoms.
   * Requires: symptoms non-empty.
   * Allowed in: OPEN.
   * Transition: OPEN → TRIAGED.
   */
  async runAiTriage(tenantId: string, id: string) {
    const c = await this.fetchCase(tenantId, id);
    this.assertStatus(
      c,
      [CaseStatus.OPEN],
      'AI triage can only be run in OPEN status.'
    );

    if (!c.symptoms || c.symptoms.trim() === '') {
      throw new BadRequestException(
        'Cannot run AI triage without symptoms. Add symptoms first.'
      );
    }

    const aiResult = await this.triageService.analyze(
      {
        species: c.patientSpecies,
        breed: c.patientBreed,
        age: c.patientAge,
        ageUnit: c.patientAgeUnit,
        weight: c.patientWeight,
      },
      c.symptoms
    );

    return this.prisma.case.update({
      where: { id },
      data: {
        status: CaseStatus.TRIAGED,
        triageResult: aiResult as unknown as Prisma.InputJsonValue,
        suggestedCatalogItemIds: aiResult.suggestedCatalogItemIds,
      },
    });
  }

  /**
   * Submit the lab order.
   * Requires: at least one CaseCatalogItem record for this case.
   * Allowed in: OPEN (skip-AI path), TRIAGED (post-AI path).
   * Transition: OPEN | TRIAGED → ORDERED.
   * orderSentAt is always set by the server — never accepted from the client.
   */
  async sendOrder(tenantId: string, id: string, body: SendOrderDto) {
    const c = await this.fetchCase(tenantId, id);
    this.assertStatus(
      c,
      MUTABLE_STATUSES,
      'Orders can only be sent in OPEN or TRIAGED status.'
    );

    const selectionCount = await this.prisma.caseCatalogItem.count({
      where: { caseId: id },
    });
    if (selectionCount === 0) {
      throw new BadRequestException(
        'Select at least one test before sending an order.'
      );
    }

    return this.prisma.case.update({
      where: { id },
      data: {
        status: CaseStatus.ORDERED,
        orderSentAt: new Date(),
        orderNotes: body.orderNotes ?? null,
      },
    });
  }

  /**
   * Attach the lab results URL once the lab delivers results.
   * Allowed in: ORDERED.
   * Does not advance status — the vet must explicitly call completeCase.
   * resultsReceivedAt is always set by the server — never accepted from the client.
   */
  async uploadResults(tenantId: string, id: string, body: UploadResultsDto) {
    const c = await this.fetchCase(tenantId, id);
    this.assertStatus(
      c,
      [CaseStatus.ORDERED],
      'Results can only be uploaded in ORDERED status.'
    );

    return this.prisma.case.update({
      where: { id },
      data: {
        resultsUrl: body.resultsUrl,
        resultsReceivedAt: new Date(),
      },
    });
  }

  /**
   * Mark the case as completed.
   * Requires: resultsUrl is already set (results must be uploaded first).
   * Allowed in: ORDERED.
   * Transition: ORDERED → COMPLETED (terminal).
   */
  async completeCase(tenantId: string, id: string) {
    const c = await this.fetchCase(tenantId, id);
    this.assertStatus(
      c,
      [CaseStatus.ORDERED],
      'A case can only be completed from ORDERED status.'
    );

    if (!c.resultsUrl) {
      throw new BadRequestException(
        'Upload results before completing the case.'
      );
    }

    return this.prisma.case.update({
      where: { id },
      data: { status: CaseStatus.COMPLETED },
    });
  }

  /**
   * Cancel the case.
   * Allowed in: OPEN, TRIAGED, ORDERED.
   * Transition: → CANCELLED (terminal).
   * COMPLETED and CANCELLED cases cannot be cancelled.
   */
  async cancelCase(tenantId: string, id: string) {
    const c = await this.fetchCase(tenantId, id);
    this.assertStatus(
      c,
      CANCELLABLE_STATUSES,
      'A completed or already cancelled case cannot be cancelled.'
    );

    return this.prisma.case.update({
      where: { id },
      data: { status: CaseStatus.CANCELLED },
    });
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Fetch a case by id scoped to the tenant (no relations — for status checks).
   */
  private async fetchCase(tenantId: string, id: string) {
    const c = await this.prisma.case.findFirst({ where: { id, tenantId } });
    if (!c) throw new NotFoundException('Case not found.');
    return c;
  }

  /**
   * Map Prisma case with selectedCatalogItems join table to API shape.
   * Flattens join rows to CatalogItemModel[], expanding package components.
   */
  private formatCase(
    raw: Awaited<ReturnType<typeof this.prisma.case.findFirstOrThrow>> & {
      selectedCatalogItems?: Array<{
        catalogItem: {
          id: string;
          kind: string;
          code: string | null;
          name: string;
          description: string | null;
          category: string | null;
          turnaroundHours: number | null;
          active: boolean;
          resultType: string | null;
          unit: string | null;
          components: Array<{
            component: {
              id: string;
              kind: string;
              code: string | null;
              name: string;
              description: string | null;
              category: string | null;
              turnaroundHours: number | null;
              active: boolean;
              resultType: string | null;
              unit: string | null;
            };
          }>;
        };
      }>;
    }
  ) {
    const selectedCatalogItems: CatalogItemModel[] | undefined =
      raw.selectedCatalogItems?.map(({ catalogItem: ci }) => ({
        id: ci.id,
        kind: ci.kind as CatalogItemModel['kind'],
        code: ci.code ?? undefined,
        name: ci.name,
        description: ci.description ?? undefined,
        category: ci.category ?? undefined,
        turnaroundHours: ci.turnaroundHours ?? undefined,
        resultType: (ci.resultType ??
          undefined) as CatalogItemModel['resultType'],
        unit: ci.unit ?? undefined,
        active: ci.active,
        components: ci.components.map(({ component: comp }) => ({
          id: comp.id,
          kind: comp.kind as CatalogItemModel['kind'],
          code: comp.code ?? undefined,
          name: comp.name,
          description: comp.description ?? undefined,
          category: comp.category ?? undefined,
          turnaroundHours: comp.turnaroundHours ?? undefined,
          resultType: (comp.resultType ??
            undefined) as CatalogItemModel['resultType'],
          unit: comp.unit ?? undefined,
          active: comp.active,
        })),
      }));

    const order = (
      raw as typeof raw & {
        order?: { requisitionNumber: string; status: string } | null;
      }
    ).order;
    const {
      selectedCatalogItems: _sc,
      order: _o,
      ...rest
    } = raw as typeof raw & { selectedCatalogItems?: unknown; order?: unknown };
    return {
      ...rest,
      selectedCatalogItems,
      order: order
        ? { orderId: order.requisitionNumber, status: order.status }
        : undefined,
    };
  }

  /**
   * Guard: throw BadRequestException when the case is not in one of the
   * allowed statuses. The message is action-specific for clear API errors.
   */
  private assertStatus(
    c: { status: CaseStatus; id: string },
    allowed: CaseStatus[],
    message: string
  ): void {
    if (!allowed.includes(c.status)) {
      throw new BadRequestException(message);
    }
  }
}
