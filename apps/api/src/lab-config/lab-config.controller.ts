import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { LabTenantGuard } from '../lab/lab-tenant.guard';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { TenantRole } from '@vet-ai/shared-types';
import type { TenantContext } from '@vet-ai/shared-types';
import { AnalyzerService } from './analyzer.service';
import { LabTestConfigService } from './lab-test-config.service';
import {
  CreateAnalyzerDto,
  UpdateAnalyzerDto,
  UpsertLabTestConfigDto,
} from './dto/lab-config.dto';

@Controller('lab-config')
@UseGuards(JwtAuthGuard, LabTenantGuard)
export class LabConfigController {
  constructor(
    private readonly analyzerService: AnalyzerService,
    private readonly labTestConfigService: LabTestConfigService
  ) {}

  // -------------------------------------------------------------------------
  // Analyzers
  // -------------------------------------------------------------------------

  @Get('analyzers')
  listAnalyzers(@CurrentTenant() tenant: TenantContext) {
    return this.analyzerService.listAnalyzers(tenant.tenantId);
  }

  @Post('analyzers')
  @Roles(TenantRole.ADMIN, TenantRole.OWNER)
  createAnalyzer(
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: CreateAnalyzerDto
  ) {
    return this.analyzerService.createAnalyzer(tenant.tenantId, dto);
  }

  @Patch('analyzers/:id')
  @Roles(TenantRole.ADMIN, TenantRole.OWNER)
  updateAnalyzer(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body() dto: UpdateAnalyzerDto
  ) {
    return this.analyzerService.updateAnalyzer(tenant.tenantId, id, dto);
  }

  @Post('analyzers/:id/enable')
  @Roles(TenantRole.ADMIN, TenantRole.OWNER)
  @HttpCode(HttpStatus.OK)
  enableAnalyzer(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string
  ) {
    return this.analyzerService.toggleActive(tenant.tenantId, id, true);
  }

  @Post('analyzers/:id/disable')
  @Roles(TenantRole.ADMIN, TenantRole.OWNER)
  @HttpCode(HttpStatus.OK)
  disableAnalyzer(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string
  ) {
    return this.analyzerService.toggleActive(tenant.tenantId, id, false);
  }

  // -------------------------------------------------------------------------
  // Test Configurations
  // -------------------------------------------------------------------------

  @Get('test-configs')
  listTestConfigs(@CurrentTenant() tenant: TenantContext) {
    return this.labTestConfigService.listConfigs(tenant.tenantId);
  }

  @Post('test-configs')
  @Roles(TenantRole.ADMIN, TenantRole.OWNER)
  upsertTestConfig(
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: UpsertLabTestConfigDto
  ) {
    return this.labTestConfigService.upsertConfig(tenant.tenantId, dto);
  }

  @Post('test-configs/generate')
  @Roles(TenantRole.ADMIN, TenantRole.OWNER)
  @HttpCode(HttpStatus.OK)
  generateTestConfigs(@CurrentTenant() tenant: TenantContext) {
    return this.labTestConfigService.generateConfigs(tenant.tenantId);
  }

  @Delete('test-configs/:id')
  @Roles(TenantRole.ADMIN, TenantRole.OWNER)
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteTestConfig(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string
  ) {
    return this.labTestConfigService.deleteConfig(tenant.tenantId, id);
  }
}
