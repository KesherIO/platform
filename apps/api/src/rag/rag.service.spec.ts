import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RagService } from './rag.service';
import { PrismaService } from '../prisma/prisma.service';

describe('RagService', () => {
  let service: RagService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RagService,
        {
          provide: PrismaService,
          useValue: { $queryRawUnsafe: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(undefined) },
        },
      ],
    }).compile();

    service = module.get(RagService);
  });

  it('creates without error', () => {
    expect(service).toBeDefined();
  });

  it('returns empty array when OPENAI_API_KEY is not configured', async () => {
    const result = await service.retrieveRelevantChunks({
      species: 'dog',
      symptoms: 'fever, lethargy',
    });
    expect(result).toEqual([]);
  });
});
