import { Injectable } from '@nestjs/common';

@Injectable()
export class CasesService {
  // TODO: Inject PrismaService for database access
  findAll(): unknown[] {
    return [];
  }

  findOne(_id: string): unknown {
    return null;
  }

  create(): unknown {
    return {};
  }
}