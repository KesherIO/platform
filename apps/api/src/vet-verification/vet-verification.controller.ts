import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { AllowOnboardingMembership } from '../auth/decorators/allow-onboarding-membership.decorator';
import type { AuthenticatedUser, TenantContext } from '@vet-ai/shared-types';
import { VetVerificationService } from './vet-verification.service';

@ApiTags('vet-verification')
@ApiBearerAuth()
@ApiSecurity('x-tenant-id')
// Vets still onboarding check and submit their verification here
@AllowOnboardingMembership()
@UseGuards(TenantGuard)
@Controller('vet-verification')
export class VetVerificationController {
  constructor(
    private readonly vetVerificationService: VetVerificationService
  ) {}

  @Get('status')
  @ApiOperation({
    summary: "Get own verification status at the clinic's connected lab",
  })
  getStatus(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTenant() tenant: TenantContext
  ) {
    return this.vetVerificationService.getStatus(user.id, tenant.tenantId);
  }

  @Post('submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Submit own credentials for verification at the clinic's lab",
  })
  submit(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTenant() tenant: TenantContext
  ) {
    return this.vetVerificationService.submit(user.id, tenant.tenantId);
  }
}
