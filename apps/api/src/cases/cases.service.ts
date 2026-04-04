import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { CaseStatus, PatientSpecies } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateCaseDto,
  UpdatePatientInfoDto,
  AddSymptomsDto,
  SelectTestsDto,
  SendOrderDto,
  UploadResultsDto,
} from './dto/cases.dto';

// ---------------------------------------------------------------------------
// Status sets — used in guard assertions throughout this service
// ---------------------------------------------------------------------------

/** Statuses where patient info and test selection are still mutable. */
const MUTABLE_STATUSES = [CaseStatus.OPEN, CaseStatus.TRIAGED];

/** Statuses from which a case may be cancelled. */
const CANCELLABLE_STATUSES = [CaseStatus.OPEN, CaseStatus.TRIAGED, CaseStatus.ORDERED];

// ---------------------------------------------------------------------------

@Injectable()
export class CasesService {
  constructor(private readonly prisma: PrismaService) {}

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
    return this.fetchCase(tenantId, id);
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
        patientBreed: body.patientBreed ?? null,
        patientAge: body.patientAge ?? null,
        patientAgeUnit: body.patientAgeUnit ?? null,
        patientWeight: body.patientWeight ?? null,
        ownerName: body.ownerName,
        ownerPhone: body.ownerPhone ?? null,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Mutations — patient info & test selection (status-gated, no transition)
  // ---------------------------------------------------------------------------

  /**
   * Partially update patient and owner fields.
   * Only provided fields are written — undefined keys are skipped entirely.
   * Allowed in: OPEN, TRIAGED.
   */
  async updatePatientInfo(tenantId: string, id: string, body: UpdatePatientInfoDto) {
    const c = await this.fetchCase(tenantId, id);
    this.assertStatus(c, MUTABLE_STATUSES, 'Patient info can only be updated in OPEN or TRIAGED status.');

    return this.prisma.case.update({
      where: { id },
      data: {
        ...(body.patientName     !== undefined && { patientName:    body.patientName     }),
        ...(body.patientSpecies  !== undefined && { patientSpecies: body.patientSpecies  }),
        ...(body.patientBreed    !== undefined && { patientBreed:   body.patientBreed    }),
        ...(body.patientAge      !== undefined && { patientAge:     body.patientAge      }),
        ...(body.patientAgeUnit  !== undefined && { patientAgeUnit: body.patientAgeUnit  }),
        ...(body.patientWeight   !== undefined && { patientWeight:  body.patientWeight   }),
        ...(body.ownerName       !== undefined && { ownerName:      body.ownerName       }),
        ...(body.ownerPhone      !== undefined && { ownerPhone:     body.ownerPhone      }),
      },
    });
  }

  /**
   * Save the free-text symptom description entered by the vet.
   * Allowed in: OPEN only. Symptoms cannot be changed after AI triage runs.
   */
  async addSymptoms(tenantId: string, id: string, body: AddSymptomsDto) {
    const c = await this.fetchCase(tenantId, id);
    this.assertStatus(c, [CaseStatus.OPEN], 'Symptoms can only be saved in OPEN status.');

    return this.prisma.case.update({
      where: { id },
      data: { symptoms: body.symptoms },
    });
  }

  /**
   * Replace the entire selected test list.
   * Allowed in: OPEN, TRIAGED (both the AI path and the manual path).
   */
  async selectTests(tenantId: string, id: string, body: SelectTestsDto) {
    const c = await this.fetchCase(tenantId, id);
    this.assertStatus(c, MUTABLE_STATUSES, 'Tests can only be selected in OPEN or TRIAGED status.');

    return this.prisma.case.update({
      where: { id },
      data: { selectedTests: body.selectedTests },
    });
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
    this.assertStatus(c, [CaseStatus.OPEN], 'AI triage can only be run in OPEN status.');

    if (!c.symptoms || c.symptoms.trim() === '') {
      throw new BadRequestException('Cannot run AI triage without symptoms. Add symptoms first.');
    }

    // TODO: Replace stub with real AI triage service (e.g., Anthropic, OpenAI, or internal model).
    // Expected output: DDx list with confidence scores + recommended test panel.
    const aiResult = await this.callAiTriage(c.symptoms, c.patientSpecies);

    return this.prisma.case.update({
      where: { id },
      data: {
        status: CaseStatus.TRIAGED,
        triageResult: aiResult.triageResult,
        suggestedTests: aiResult.suggestedTests,
      },
    });
  }

  /**
   * Submit the lab order.
   * Requires: selectedTests is non-empty.
   * Allowed in: OPEN (skip-AI path), TRIAGED (post-AI path).
   * Transition: OPEN | TRIAGED → ORDERED.
   * orderSentAt is always set by the server — never accepted from the client.
   */
  async sendOrder(tenantId: string, id: string, body: SendOrderDto) {
    const c = await this.fetchCase(tenantId, id);
    this.assertStatus(c, MUTABLE_STATUSES, 'Orders can only be sent in OPEN or TRIAGED status.');

    const tests = c.selectedTests as unknown as string[] | null;
    if (!tests || tests.length === 0) {
      throw new BadRequestException('Select at least one test before sending an order.');
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
    this.assertStatus(c, [CaseStatus.ORDERED], 'Results can only be uploaded in ORDERED status.');

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
    this.assertStatus(c, [CaseStatus.ORDERED], 'A case can only be completed from ORDERED status.');

    if (!c.resultsUrl) {
      throw new BadRequestException('Upload results before completing the case.');
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
      'A completed or already cancelled case cannot be cancelled.',
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
   * Fetch a case by id scoped to the tenant.
   * Using findFirst with { id, tenantId } in a single query enforces tenant
   * isolation: a case that exists but belongs to a different tenant returns
   * null, and is indistinguishable from a case that does not exist at all.
   * This prevents tenants from probing each other's case IDs.
   */
  private async fetchCase(tenantId: string, id: string) {
    const c = await this.prisma.case.findFirst({ where: { id, tenantId } });
    if (!c) throw new NotFoundException('Case not found.');
    return c;
  }

  /**
   * Guard: throw BadRequestException when the case is not in one of the
   * allowed statuses. The message is action-specific for clear API errors.
   */
  private assertStatus(
    c: { status: CaseStatus; id: string },
    allowed: CaseStatus[],
    message: string,
  ): void {
    if (!allowed.includes(c.status)) {
      throw new BadRequestException(message);
    }
  }

  /**
   * Stub for the AI triage integration.
   * Replace with a real service call when the AI layer is built.
   * Expected output shape:
   *   triageResult — DDx list: [{ diagnosis: string, confidence: number, explanation?: string }]
   *   suggestedTests — ordered test panel: string[]
   */
  private async callAiTriage(
    _symptoms: string,
    _species: PatientSpecies,
  ): Promise<{ triageResult: Record<string, unknown>; suggestedTests: string[] }> {
    // TODO: integrate real AI model — Anthropic, OpenAI, or internal triage engine
    return {
      triageResult: {},
      suggestedTests: [],
    };
  }
}
