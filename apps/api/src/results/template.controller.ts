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
import { Roles } from '../auth/decorators/roles.decorator';
import { TenantRole } from '@vet-ai/shared-types';
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

  @Get('templates/:id')
  getDefinition(@Param('id') id: string) {
    return this.templateService.getDefinition(id);
  }

  @Post('templates')
  @Roles(TenantRole.ADMIN, TenantRole.OWNER)
  createDefinition(
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: CreateTemplateDefinitionDto
  ) {
    return this.templateService.createDefinition(tenant.tenantId, dto);
  }

  @Post('templates/:id/clone')
  @Roles(TenantRole.ADMIN, TenantRole.OWNER)
  @HttpCode(HttpStatus.OK)
  cloneFromPlatform(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string
  ) {
    return this.templateService.cloneFromPlatform(tenant.tenantId, id);
  }

  @Post('templates/:id/draft')
  @Roles(TenantRole.ADMIN, TenantRole.OWNER)
  createDraftVersion(@Param('id') id: string) {
    return this.templateService.createDraftVersion(id);
  }

  @Patch('template-versions/:id')
  @Roles(TenantRole.ADMIN, TenantRole.OWNER)
  updateDraftVersion(
    @Param('id') id: string,
    @Body() dto: UpdateDraftVersionDto
  ) {
    return this.templateService.updateDraftVersion(id, dto);
  }

  @Post('template-versions/:id/publish')
  @Roles(TenantRole.ADMIN, TenantRole.OWNER)
  @HttpCode(HttpStatus.OK)
  publishVersion(@Param('id') id: string) {
    return this.templateService.publishVersion(id);
  }

  @Post('template-versions/:id/archive')
  @Roles(TenantRole.ADMIN, TenantRole.OWNER)
  @HttpCode(HttpStatus.OK)
  archiveVersion(@Param('id') id: string) {
    return this.templateService.archiveVersion(id);
  }

  @Delete('templates/:id')
  @Roles(TenantRole.ADMIN, TenantRole.OWNER)
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteDefinition(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string
  ) {
    return this.templateService.deleteDefinition(id, tenant.tenantId);
  }
}
