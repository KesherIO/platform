import { Injectable } from '@nestjs/common';

@Injectable()
export class TenantsService {
  // TODO: Inject PrismaService
  findOne(_id: string): unknown {
    return null;
  }
}