import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TriageService } from './triage.service';
import { CatalogService } from '../catalog/catalog.service';
import { PatientSpecies, AgeUnit } from '@prisma/client';

const MOCK_CATALOG = [
  {
    id: 'id-cbc',
    kind: 'TEST',
    code: 'CBC',
    name: 'Complete Blood Count',
    category: 'Hematology',
    active: true,
  },
  {
    id: 'id-bmp',
    kind: 'TEST',
    code: 'BMP',
    name: 'Basic Metabolic Panel',
    category: 'Chemistry',
    active: true,
  },
];

describe('TriageService', () => {
  let service: TriageService;
  let catalogService: jest.Mocked<CatalogService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TriageService,
        {
          provide: ConfigService,
          useValue: { getOrThrow: () => 'test-key' },
        },
        {
          provide: CatalogService,
          useValue: { findAll: jest.fn().mockResolvedValue(MOCK_CATALOG) },
        },
      ],
    }).compile();

    service = module.get(TriageService);
    catalogService = module.get(CatalogService);
  });

  it('creates without error', () => {
    expect(service).toBeDefined();
  });

  it('fetches catalog on analyze', async () => {
    // Spy on the Anthropic client to avoid real network calls
    const mockCreate = jest.fn().mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            diagnoses: [
              {
                name: 'Gastroenteritis',
                confidence: 80,
                explanation: 'GI upset.',
              },
              {
                name: 'Pancreatitis',
                confidence: 55,
                explanation: 'Abdominal pain.',
              },
              {
                name: 'Hepatic Disease',
                confidence: 30,
                explanation: 'Lethargy.',
              },
            ],
            suggestedCatalogItemIds: ['id-cbc', 'id-bmp'],
          }),
        },
      ],
    });

    // @ts-expect-error: accessing private client for test
    service['client'] = { messages: { create: mockCreate } };

    const result = await service.analyze(
      {
        species: PatientSpecies.DOG,
        breed: 'Labrador',
        age: 3,
        ageUnit: AgeUnit.YEARS,
        weight: 28,
      },
      'Vomiting and lethargy for 2 days'
    );

    expect(catalogService.findAll).toHaveBeenCalledWith(false);
    expect(result.diagnoses).toHaveLength(3);
    expect(result.suggestedCatalogItemIds).toEqual(['id-cbc', 'id-bmp']);
  });

  it('filters out catalog IDs not in the catalog', async () => {
    const mockCreate = jest.fn().mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            diagnoses: [
              { name: 'A', confidence: 80, explanation: 'x' },
              { name: 'B', confidence: 60, explanation: 'x' },
              { name: 'C', confidence: 40, explanation: 'x' },
            ],
            suggestedCatalogItemIds: ['id-cbc', 'hallucinated-id'],
          }),
        },
      ],
    });

    // @ts-expect-error: accessing private client for test
    service['client'] = { messages: { create: mockCreate } };

    const result = await service.analyze(
      { species: PatientSpecies.CAT },
      'Sneezing'
    );

    expect(result.suggestedCatalogItemIds).toEqual(['id-cbc']);
  });
});
