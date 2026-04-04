import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CasesService } from './cases.service';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import type { AuthenticatedUser, TenantContext } from '@vet-ai/shared-types';
import {
  CreateCaseDto,
  UpdatePatientInfoDto,
  AddSymptomsDto,
  SelectTestsDto,
  SendOrderDto,
  UploadResultsDto,
} from './dto/cases.dto';

@ApiTags('cases')
@ApiBearerAuth()
@UseGuards(TenantGuard)
@Controller('cases')
export class CasesController {
  constructor(private readonly casesService: CasesService) {}

  // ---------------------------------------------------------------------------
  // POST /cases
  // Create a new case. Both ADMIN and STAFF can create cases.
  // ---------------------------------------------------------------------------

  @Post()
  @ApiOperation({ summary: 'Create a new case' })
  createCase(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTenant() tenant: TenantContext,
    @Body() body: CreateCaseDto,
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
    @CurrentTenant() tenant: TenantContext,
  ) {
    return this.casesService.findAll(tenant.tenantId, user.id);
  }

  // ---------------------------------------------------------------------------
  // GET /cases/:id
  // Fetch a single case. Membership check is enforced by TenantGuard.
  // ---------------------------------------------------------------------------

  @Get(':id')
  @ApiOperation({ summary: 'Get a single case by ID' })
  findOne(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
  ) {
    return this.casesService.findOne(tenant.tenantId, id);
  }

  // ---------------------------------------------------------------------------
  // PATCH /cases/:id
  // Update patient and owner info. Allowed in: OPEN, TRIAGED.
  // ---------------------------------------------------------------------------

  @Patch(':id')
  @ApiOperation({ summary: 'Update patient and owner info (OPEN or TRIAGED only)' })
  updatePatientInfo(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body() body: UpdatePatientInfoDto,
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
    @Body() body: AddSymptomsDto,
  ) {
    return this.casesService.addSymptoms(tenant.tenantId, id, body);
  }

  // ---------------------------------------------------------------------------
  // PATCH /cases/:id/tests
  // Replace the selected test list. Allowed in: OPEN, TRIAGED.
  // ---------------------------------------------------------------------------

  @Patch(':id/tests')
  @ApiOperation({ summary: 'Set the selected tests (OPEN or TRIAGED only)' })
  selectTests(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body() body: SelectTestsDto,
  ) {
    return this.casesService.selectTests(tenant.tenantId, id, body);
  }

  // ---------------------------------------------------------------------------
  // POST /cases/:id/triage
  // Trigger AI triage using the stored symptoms. Allowed in: OPEN.
  // No request body — AI reads symptoms already saved on the case.
  // ---------------------------------------------------------------------------

  @Post(':id/triage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Run AI triage on stored symptoms (OPEN only)' })
  runAiTriage(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
  ) {
    return this.casesService.runAiTriage(tenant.tenantId, id);
  }

  // ---------------------------------------------------------------------------
  // POST /cases/:id/order
  // Submit the lab order. Requires selectedTests to be set. Allowed in: OPEN, TRIAGED.
  // ---------------------------------------------------------------------------

  @Post(':id/order')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send the lab order (OPEN or TRIAGED only, requires selected tests)' })
  sendOrder(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body() body: SendOrderDto,
  ) {
    return this.casesService.sendOrder(tenant.tenantId, id, body);
  }

  // ---------------------------------------------------------------------------
  // POST /cases/:id/results
  // Attach the results URL once the lab sends results. Allowed in: ORDERED.
  // ---------------------------------------------------------------------------

  @Post(':id/results')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Upload results URL (ORDERED only)' })
  uploadResults(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body() body: UploadResultsDto,
  ) {
    return this.casesService.uploadResults(tenant.tenantId, id, body);
  }

  // ---------------------------------------------------------------------------
  // POST /cases/:id/complete
  // Mark the case as completed. Requires resultsUrl to be set. Allowed in: ORDERED.
  // ---------------------------------------------------------------------------

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete the case (ORDERED only, requires results uploaded)' })
  completeCase(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
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
  cancelCase(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
  ) {
    return this.casesService.cancelCase(tenant.tenantId, id);
  }
}
