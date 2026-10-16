import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { LabTenantGuard } from '../lab/lab-tenant.guard';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { LAB_STAFF_ROLES } from '../lab/lab-roles';
import { Roles } from '../auth/decorators/roles.decorator';
import type { TenantContext } from '@vet-ai/shared-types';
import { TemplateVersionService } from './template-version.service';
import {
  CreateTemplateDefinitionDto,
  UpdateDraftVersionDto,
} from './dto/template-version.dto';

@Controller('lab')
@UseGuards(JwtAuthGuard, LabTenantGuard)
export class TemplateController {
  constructor(private readonly templateService: TemplateVersionService) {}

  @Roles(...LAB_STAFF_ROLES)
  @Get('templates')
  listDefinitions(
    @CurrentTenant() tenant: TenantContext,
    @Query('catalogItemCode') catalogItemCode?: string,
    @Query('species') species?: string
  ) {
    return this.templateService.listDefinitions(tenant.tenantId, {
      catalogItemCode,
      species,
    });
  }

  @Roles(...LAB_STAFF_ROLES)
  @Get('templates/:id')
  getDefinition(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string
  ) {
    return this.templateService.getDefinition(id, tenant.tenantId);
  }

  @Post('templates')
  @Roles(...LAB_STAFF_ROLES)
  createDefinition(
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: CreateTemplateDefinitionDto
  ) {
    return this.templateService.createDefinition(tenant.tenantId, dto);
  }

  @Post('templates/:id/clone')
  @Roles(...LAB_STAFF_ROLES)
  @HttpCode(HttpStatus.OK)
  cloneFromPlatform(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string
  ) {
    return this.templateService.cloneFromPlatform(tenant.tenantId, id);
  }

  @Post('templates/:id/draft')
  @Roles(...LAB_STAFF_ROLES)
  createDraftVersion(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string
  ) {
    return this.templateService.createDraftVersion(id, tenant.tenantId);
  }

  @Patch('template-versions/:id')
  @Roles(...LAB_STAFF_ROLES)
  updateDraftVersion(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body() dto: UpdateDraftVersionDto
  ) {
    return this.templateService.updateDraftVersion(id, dto, tenant.tenantId);
  }

  @Post('template-versions/:id/publish')
  @Roles(...LAB_STAFF_ROLES)
  @HttpCode(HttpStatus.OK)
  publishVersion(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string
  ) {
    return this.templateService.publishVersion(id, tenant.tenantId);
  }

  @Post('template-versions/:id/archive')
  @Roles(...LAB_STAFF_ROLES)
  @HttpCode(HttpStatus.OK)
  archiveVersion(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string
  ) {
    return this.templateService.archiveVersion(id, tenant.tenantId);
  }

  @Delete('templates/:id')
  @Roles(...LAB_STAFF_ROLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteDefinition(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string
  ) {
    return this.templateService.deleteDefinition(id, tenant.tenantId);
  }
}
