import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiHeader,
} from '@nestjs/swagger';
import { CatalogService } from './catalog.service';
import {
  CreateCatalogItemDto,
  ImportCatalogDto,
  ListCatalogAdminDto,
  UpdateCatalogItemDto,
} from './dto/catalog.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { InternalApiKeyGuard } from '../auth/guards/internal-api-key.guard';
import { LabTenantGuard } from '../lab/lab-tenant.guard';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { TenantRole } from '@vet-ai/shared-types';
import type { TenantContext } from '@vet-ai/shared-types';

@ApiTags('catalog')
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  // ---------------------------------------------------------------------------
  // GET /catalog
  // Clinic-facing — returns the active catalog of whichever lab the
  // requesting clinic is connected to.
  // ---------------------------------------------------------------------------

  @Get()
  @UseGuards(JwtAuthGuard, TenantGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "List the requesting clinic's connected lab catalog",
  })
  findAll(@CurrentTenant() tenant: TenantContext) {
    return this.catalogService.findAll(tenant.tenantId);
  }

  // ---------------------------------------------------------------------------
  // POST /catalog/import
  // Lab-only operation — protected by internal API key, not a clinic role.
  // ---------------------------------------------------------------------------

  @Post('import')
  @Public()
  @UseGuards(InternalApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('x-internal-api-key')
  @ApiHeader({
    name: 'x-internal-api-key',
    description: 'Platform internal API key',
    required: true,
  })
  @ApiOperation({
    summary: "Import (upsert) one lab's catalog items — internal use only",
  })
  import(@Body() body: ImportCatalogDto) {
    return this.catalogService.import(body);
  }

  // ---------------------------------------------------------------------------
  // Admin CRUD — lab-scoped. labTenantId always comes from the authenticated
  // lab's own session (via LabTenantGuard), never from the client.
  //
  // Deliberately no DELETE route: catalog items may be referenced by
  // historical cases/orders (CaseCatalogItem, OrderedTest), and hard-deleting
  // one would corrupt that history. Use POST /:id/disable (active: false)
  // instead — see CatalogService.setActive.
  // ---------------------------------------------------------------------------

  @Get('admin')
  @UseGuards(JwtAuthGuard, LabTenantGuard)
  @Roles(TenantRole.ADMIN, TenantRole.OWNER)
  @ApiOperation({ summary: "List the lab's own catalog (all items, admin)" })
  findAllAdmin(
    @CurrentTenant() tenant: TenantContext,
    @Query() query: ListCatalogAdminDto
  ) {
    return this.catalogService.findAllAdmin(tenant.tenantId, query);
  }

  @Post()
  @UseGuards(JwtAuthGuard, LabTenantGuard)
  @Roles(TenantRole.ADMIN, TenantRole.OWNER)
  @ApiOperation({ summary: "Create a catalog item in the lab's own catalog" })
  create(
    @CurrentTenant() tenant: TenantContext,
    @Body() body: CreateCatalogItemDto
  ) {
    return this.catalogService.createItem(tenant.tenantId, body);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, LabTenantGuard)
  @Roles(TenantRole.ADMIN, TenantRole.OWNER)
  @ApiOperation({ summary: "Update a catalog item in the lab's own catalog" })
  update(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body() body: UpdateCatalogItemDto
  ) {
    return this.catalogService.updateItem(tenant.tenantId, id, body);
  }

  @Post(':id/enable')
  @UseGuards(JwtAuthGuard, LabTenantGuard)
  @Roles(TenantRole.ADMIN, TenantRole.OWNER)
  @ApiOperation({ summary: 'Re-enable a catalog item' })
  enable(@CurrentTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.catalogService.setActive(tenant.tenantId, id, true);
  }

  @Post(':id/disable')
  @UseGuards(JwtAuthGuard, LabTenantGuard)
  @Roles(TenantRole.ADMIN, TenantRole.OWNER)
  @ApiOperation({ summary: 'Disable a catalog item' })
  disable(@CurrentTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.catalogService.setActive(tenant.tenantId, id, false);
  }
}
