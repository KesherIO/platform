import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CasesService } from './cases.service';
import { OrdersService } from '../orders/orders.service';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import type { AuthenticatedUser, TenantContext } from '@vet-ai/shared-types';
import {
  CreateCaseDto,
  UpdatePatientInfoDto,
  AddSymptomsDto,
  SelectCatalogItemsDto,
} from './dto/cases.dto';
import { CreateOrderDto } from '../orders/dto/create-order.dto';

@ApiTags('cases')
@ApiBearerAuth()
@UseGuards(TenantGuard)
@Controller('cases')
export class CasesController {
  constructor(
    private readonly casesService: CasesService,
    private readonly ordersService: OrdersService
  ) {}

  // ---------------------------------------------------------------------------
  // POST /cases
  // Create a new case. Both ADMIN and STAFF can create cases.
  // ---------------------------------------------------------------------------

  @Post()
  @ApiOperation({ summary: 'Create a new case' })
  createCase(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTenant() tenant: TenantContext,
    @Body() body: CreateCaseDto
  ) {
    return this.casesService.createCase(tenant.tenantId, user.id, body);
  }

  // ---------------------------------------------------------------------------
  // GET /cases
  // List all cases scoped to the active tenant.
  // ---------------------------------------------------------------------------

  @Get()
  @ApiOperation({ summary: 'List all cases for the active tenant' })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTenant() tenant: TenantContext
  ) {
    return this.casesService.findAll(tenant.tenantId, user.id);
  }

  // ---------------------------------------------------------------------------
  // GET /cases/:id
  // Fetch a single case. Membership check is enforced by TenantGuard.
  // ---------------------------------------------------------------------------

  @Get(':id')
  @ApiOperation({ summary: 'Get a single case by ID' })
  findOne(@CurrentTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.casesService.findOne(tenant.tenantId, id);
  }

  // ---------------------------------------------------------------------------
  // PATCH /cases/:id
  // Update patient and owner info. Allowed in: OPEN, TRIAGED.
  // ---------------------------------------------------------------------------

  @Patch(':id')
  @ApiOperation({
    summary: 'Update patient and owner info (OPEN or TRIAGED only)',
  })
  updatePatientInfo(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body() body: UpdatePatientInfoDto
  ) {
    return this.casesService.updatePatientInfo(tenant.tenantId, id, body);
  }

  // ---------------------------------------------------------------------------
  // PATCH /cases/:id/symptoms
  // Save symptom text entered by the vet. Allowed in: OPEN.
  // ---------------------------------------------------------------------------

  @Patch(':id/symptoms')
  @ApiOperation({ summary: 'Save symptom description (OPEN only)' })
  addSymptoms(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body() body: AddSymptomsDto
  ) {
    return this.casesService.addSymptoms(tenant.tenantId, id, body);
  }

  // ---------------------------------------------------------------------------
  // PATCH /cases/:id/catalog-selection
  // Replace the selected catalog item list. Allowed in: OPEN, TRIAGED.
  // ---------------------------------------------------------------------------

  @Patch(':id/catalog-selection')
  @ApiOperation({
    summary: 'Set selected catalog items (OPEN or TRIAGED only)',
  })
  selectCatalogItems(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body() body: SelectCatalogItemsDto
  ) {
    return this.casesService.selectCatalogItems(tenant.tenantId, id, body);
  }

  // ---------------------------------------------------------------------------
  // POST /cases/:id/triage
  // Trigger AI triage using the stored symptoms. Allowed in: OPEN.
  // No request body — AI reads symptoms already saved on the case.
  // ---------------------------------------------------------------------------

  @Post(':id/triage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Run AI triage on stored symptoms (OPEN only)' })
  runAiTriage(@CurrentTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.casesService.runAiTriage(tenant.tenantId, id);
  }

  // ---------------------------------------------------------------------------
  // POST /cases/:id/order
  // Submit the lab order. Requires selectedCatalogItems to be set. Allowed in: OPEN, TRIAGED.
  // ---------------------------------------------------------------------------

  @Post(':id/order')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Create a lab order for this case (OPEN or TRIAGED only, requires selected tests)',
  })
  createOrder(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body() body: CreateOrderDto
  ) {
    return this.ordersService.createOrderForCase(tenant.tenantId, id, body);
  }

  // ---------------------------------------------------------------------------
  // POST /cases/:id/complete
  // Mark the case as completed. Allowed in: ORDERED.
  // Results are entered via POST /results — not via this endpoint.
  // ---------------------------------------------------------------------------

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Complete the case (ORDERED only, requires results uploaded)',
  })
  completeCase(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string
  ) {
    return this.casesService.completeCase(tenant.tenantId, id);
  }

  // ---------------------------------------------------------------------------
  // POST /cases/:id/cancel
  // Cancel the case from any non-terminal status. Allowed in: OPEN, TRIAGED, ORDERED.
  // ---------------------------------------------------------------------------

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel the case (OPEN, TRIAGED, or ORDERED only)' })
  cancelCase(@CurrentTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.casesService.cancelCase(tenant.tenantId, id);
  }

  // ---------------------------------------------------------------------------
  // DELETE /cases/:id
  // Permanently delete a case. Allowed in: OPEN, TRIAGED, CANCELLED.
  // ---------------------------------------------------------------------------

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a case (OPEN, TRIAGED, or CANCELLED only)' })
  deleteCase(@CurrentTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.casesService.deleteCase(tenant.tenantId, id);
  }
}
