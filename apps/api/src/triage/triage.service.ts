import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { CatalogService } from '../catalog/catalog.service';
import { DiagnosisModel, TriageResultModel } from '@vet-ai/shared-types';
import { PatientSpecies, AgeUnit } from '@prisma/client';

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a veterinary clinical decision support assistant embedded in a lab ordering platform.

Given a patient description and symptom narrative, return ONLY a valid JSON object — no markdown, no explanation — matching this exact schema:
{
  "diagnoses": [
    { "name": "string", "confidence": 75, "explanation": "string" },
    { "name": "string", "confidence": 55, "explanation": "string" },
    { "name": "string", "confidence": 30, "explanation": "string" }
  ],
  "suggestedCatalogItemIds": ["id1", "id2"]
}

Rules:
- Provide exactly 3 differential diagnoses ordered by confidence descending
- confidence is an integer 0–100
- explanation is 1–2 sentences of clinical reasoning
- suggestedCatalogItemIds must contain ONLY id values from the catalog list provided
- ALWAYS prefer packages over individual tests when a package covers the needed tests — never suggest a test individually if a package already includes it
- If two packages overlap significantly, pick the one that covers more of the needed tests and skip the other — do not select both
- Consider species differences in normal values and disease prevalence`;

// ---------------------------------------------------------------------------

interface PatientContext {
  species: PatientSpecies;
  breed?: string | null;
  age?: number | null;
  ageUnit?: AgeUnit | null;
  weight?: number | null;
}

interface RawTriageResponse {
  diagnoses: DiagnosisModel[];
  suggestedCatalogItemIds: string[];
}

@Injectable()
export class TriageService {
  private readonly client: Anthropic;

  constructor(
    private readonly config: ConfigService,
    private readonly catalogService: CatalogService
  ) {
    this.client = new Anthropic({
      apiKey: this.config.getOrThrow<string>('ANTHROPIC_API_KEY'),
    });
  }

  async analyze(
    patient: PatientContext,
    symptoms: string
  ): Promise<TriageResultModel> {
    const catalogItems = await this.catalogService.findAll(false);
    const catalogJson = JSON.stringify(
      catalogItems.map((i) => ({
        id: i.id,
        kind: i.kind,
        code: i.code,
        name: i.name,
        category: i.category,
        ...(i.components?.length
          ? { includes: i.components.map((c) => c.name) }
          : {}),
      }))
    );

    const patientLine = [
      `Species: ${patient.species}`,
      patient.breed ? `Breed: ${patient.breed}` : null,
      patient.age != null && patient.ageUnit
        ? `Age: ${patient.age} ${patient.ageUnit.toLowerCase()}`
        : null,
      patient.weight != null ? `Weight: ${patient.weight} kg` : null,
    ]
      .filter(Boolean)
      .join(' | ');

    const response = await this.client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 700,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
        {
          type: 'text',
          text: `Available catalog items:\n${catalogJson}`,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: `${patientLine}\nSymptoms: ${symptoms}`,
        },
      ],
    });

    const text =
      response.content[0].type === 'text' ? response.content[0].text : '';

    const cleaned = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();

    let parsed: RawTriageResponse;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new InternalServerErrorException(
        'AI triage returned malformed JSON.'
      );
    }

    const validIds = new Set(catalogItems.map((i) => i.id));
    const suggestedCatalogItemIds = (
      parsed.suggestedCatalogItemIds ?? []
    ).filter((id) => validIds.has(id));

    const diagnoses: DiagnosisModel[] = (parsed.diagnoses ?? [])
      .slice(0, 3)
      .map((d) => ({
        name: d.name,
        confidence: Math.min(100, Math.max(0, Math.round(d.confidence))),
        explanation: d.explanation,
      }));

    return { diagnoses, suggestedCatalogItemIds };
  }
}
