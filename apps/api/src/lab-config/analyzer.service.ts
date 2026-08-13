import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAnalyzerDto, UpdateAnalyzerDto } from './dto/lab-config.dto';

@Injectable()
export class AnalyzerService {
  constructor(private readonly prisma: PrismaService) {}

  async listAnalyzers(labTenantId: string) {
    return this.prisma.analyzer.findMany({
      where: { labTenantId },
      orderBy: { name: 'asc' },
    });
  }

  async getAnalyzer(labTenantId: string, id: string) {
    const analyzer = await this.prisma.analyzer.findFirst({
      where: { id, labTenantId },
    });
    if (!analyzer) throw new NotFoundException('Analyzer not found');
    return analyzer;
  }

  async createAnalyzer(labTenantId: string, dto: CreateAnalyzerDto) {
    return this.prisma.analyzer.create({
      data: {
        labTenantId,
        name: dto.name,
        model: dto.model,
        manufacturer: dto.manufacturer,
        department: dto.department,
      },
    });
  }

  async updateAnalyzer(labTenantId: string, id: string, dto: UpdateAnalyzerDto) {
    await this.getAnalyzer(labTenantId, id);
    return this.prisma.analyzer.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.model !== undefined && { model: dto.model }),
        ...(dto.manufacturer !== undefined && { manufacturer: dto.manufacturer }),
        ...(dto.department !== undefined && { department: dto.department }),
      },
    });
  }

  async toggleActive(labTenantId: string, id: string, isActive: boolean) {
    await this.getAnalyzer(labTenantId, id);
    return this.prisma.analyzer.update({
      where: { id },
      data: { isActive },
    });
  }
}
