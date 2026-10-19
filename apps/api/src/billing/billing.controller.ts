import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { TenantRole } from '@vet-ai/shared-types';
import type { AuthenticatedUser, TenantContext } from '@vet-ai/shared-types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { LabTenantGuard } from '../lab/lab-tenant.guard';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { LAB_BILLING_EXPORT_ROLES } from '../lab/lab-roles';
import { BillingExportAccessGuard } from './billing-export-access.guard';
import { BillingExportService } from './billing-export.service';
import { BillingMappingService } from './billing-mapping.service';
import {
  ApplyMappingDto,
  AssignDeletedItemCodeDto,
  CreateBillingExportDto,
  PreviewBillingExportDto,
  SuggestMappingDto,
} from './dto/billing.dto';

/**
 * Billing codes and the billing export. Setting codes (mapping, deleted-item
 * codes) is Owner/Admin only, like the catalog it extends. Downloading the
 * export (preview, generate, history, re-download) is also open to "Consulta"
 * with the in-progress checkbox — see @Roles on those four routes.
 * labTenantId always comes from the session.
 */
@Controller('lab/billing')
@UseGuards(JwtAuthGuard, LabTenantGuard)
@Roles(TenantRole.ADMIN, TenantRole.OWNER)
export class BillingController {
  constructor(
    private readonly exportService: BillingExportService,
    private readonly mappingService: BillingMappingService
  ) {}

  // POST /api/lab/billing/mapping/suggest — read-only suggestions
  @Post('mapping/suggest')
  @HttpCode(HttpStatus.OK)
  suggest(
    @CurrentTenant() tenant: TenantContext,
    @Body() body: SuggestMappingDto
  ) {
    return this.mappingService.suggest(tenant.tenantId, body.rows);
  }

  // POST /api/lab/billing/mapping/apply — saves the pairs the user confirmed
  @Post('mapping/apply')
  @HttpCode(HttpStatus.OK)
  apply(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ApplyMappingDto
  ) {
    return this.mappingService.apply(
      tenant.tenantId,
      body.assignments,
      body.replaceExisting === true,
      user.id
    );
  }

  // PUT /api/lab/billing/deleted-items/:catalogItemId/code — a reviewed code
  // for order lines whose catalog item was deleted (orders stay as they were)
  @Put('deleted-items/:catalogItemId/code')
  assignDeletedItemCode(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('catalogItemId') catalogItemId: string,
    @Body() body: AssignDeletedItemCodeDto
  ) {
    const name =
      [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email;
    return this.mappingService.assignDeletedItemCode(
      tenant.tenantId,
      catalogItemId,
      body.billingCode,
      { id: user.id, name }
    );
  }

  // DELETE /api/lab/billing/deleted-items/:catalogItemId/code
  @Delete('deleted-items/:catalogItemId/code')
  clearDeletedItemCode(
    @CurrentTenant() tenant: TenantContext,
    @Param('catalogItemId') catalogItemId: string
  ) {
    return this.mappingService.clearDeletedItemCode(
      tenant.tenantId,
      catalogItemId
    );
  }

  // GET /api/lab/billing/exports/preview?dateFrom=&dateTo=&onlyNew=
  // Declared before exports/:id so "preview" isn't read as an id.
  @Get('exports/preview')
  @Roles(...LAB_BILLING_EXPORT_ROLES)
  @UseGuards(BillingExportAccessGuard)
  preview(
    @CurrentTenant() tenant: TenantContext,
    @Query() query: PreviewBillingExportDto
  ) {
    return this.exportService.preview(
      tenant.tenantId,
      query.dateFrom,
      query.dateTo,
      query.onlyNew === true
    );
  }

  // POST /api/lab/billing/exports — records and returns the rows to write
  @Post('exports')
  @Roles(...LAB_BILLING_EXPORT_ROLES)
  @UseGuards(BillingExportAccessGuard)
  @HttpCode(HttpStatus.OK)
  generate(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateBillingExportDto
  ) {
    const name =
      [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email;
    return this.exportService.generate(
      tenant.tenantId,
      { id: user.id, name },
      body
    );
  }

  // GET /api/lab/billing/exports — history (generated files, newest first)
  @Get('exports')
  @Roles(...LAB_BILLING_EXPORT_ROLES)
  @UseGuards(BillingExportAccessGuard)
  list(@CurrentTenant() tenant: TenantContext) {
    return this.exportService.list(tenant.tenantId);
  }

  // GET /api/lab/billing/exports/:id — the rows as generated, for re-download
  @Get('exports/:id')
  @Roles(...LAB_BILLING_EXPORT_ROLES)
  @UseGuards(BillingExportAccessGuard)
  get(@CurrentTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.exportService.get(tenant.tenantId, id);
  }
}
