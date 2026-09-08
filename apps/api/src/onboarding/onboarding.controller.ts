import {
  Controller,
  Post,
  Delete,
  Body,
  Get,
  Param,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiConsumes,
  ApiHeader,
} from '@nestjs/swagger';
import { OnboardingService } from './onboarding.service';
import { Public } from '../auth/decorators/public.decorator';
import { InternalApiKeyGuard } from '../auth/guards/internal-api-key.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@vet-ai/shared-types';
import {
  SaveStaffProfileDto,
  GenerateInviteDto,
  CreateAdminLinkDto,
  CompleteAdminOnboardingDto,
  CompleteStaffOnboardingDto,
  CreateLabLinkDto,
  CompleteLabOnboardingDto,
  DeleteLabDto,
} from './dto/onboarding.dto';

@ApiTags('onboarding')
@ApiBearerAuth()
@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  /**
   * Public — fetched before the user has a tenant membership.
   * Used to display clinic branding on the onboarding welcome screen.
   */
  @Get(':tenantId/branding')
  @Public()
  @ApiOperation({ summary: '[Clinic] Get clinic branding for welcome screen (public, no auth)' })
  getBranding(@Param('tenantId') tenantId: string) {
    return this.onboardingService.getBranding(tenantId);
  }

  /**
   * Public — verifies a staff invite token before showing the profile form.
   * Returns tenant branding + invite metadata so the staff screen can render.
   */
  @Get('invite/verify/:token')
  @Public()
  @ApiOperation({ summary: '[Clinic] Verify a staff invite token (public, no auth)' })
  verifyInvite(@Param('token') token: string) {
    return this.onboardingService.verifyInvite(token);
  }

  /**
   * Protected — staff member accepts invite and saves their profile.
   * Token is included in the request body (received via magic link URL).
   * tenantId is passed as a query param.
   */
  @Post('staff-profile')
  @ApiOperation({ summary: '[Clinic] Save staff profile after accepting invite (authenticated)' })
  saveStaffProfile(
    @Body() body: SaveStaffProfileDto,
    @Query('tenantId') tenantId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.onboardingService.saveStaffProfile(
      user.id,
      tenantId,
      body.token,
      body
    );
  }

  /**
   * Protected — admin/owner generates a staff invitation token.
   * tenantId is passed as a query param.
   */
  @Post('invite')
  @ApiOperation({ summary: '[Clinic] Generate a staff invite link (authenticated, admin/owner)' })
  generateInvite(
    @Body() body: GenerateInviteDto,
    @Query('tenantId') tenantId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return this.onboardingService.generateInvite(user.id, tenantId, body);
  }

  /**
   * Public — completes STAFF onboarding. Invite token is the only credential.
   * Creates: Supabase Auth user (email pre-confirmed) → local User row → membership.
   * Marks the invite as accepted. After this returns, the frontend signs in with
   * signInWithPassword() using the email and password submitted in the form.
   *
   * Input:  { token, fullName, telephone?, email, password, role }
   * Output: { userId }
   */
  @Post('complete-staff')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '[Clinic] Complete staff onboarding via invite token (public, no auth)' })
  completeStaffOnboarding(@Body() body: CompleteStaffOnboardingDto) {
    return this.onboardingService.completeStaffOnboarding(body);
  }

  // ── New token-based admin onboarding endpoints ────────────────────────────

  /**
   * Internal — requires x-internal-api-key header (INTERNAL_API_KEY env var).
   * Called by KesherIO to create a secure onboarding link for a new clinic admin.
   *
   * Input: { clinicName, clinicEmail, externalClinicId? }
   * Output: { token, onboardingLink: "/onboarding/welcome?token=<hex>" }
   */
  @Post('admin-link')
  @Public()
  @UseGuards(InternalApiKeyGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: '[Clinic] Create a clinic admin onboarding link (internal, x-api-key)',
  })
  @ApiHeader({
    name: 'x-internal-api-key',
    description: 'Internal API key for KesherIO-only endpoints',
    required: true,
  })
  createAdminLink(@Body() body: CreateAdminLinkDto) {
    return this.onboardingService.createAdminLink(body);
  }

  /**
   * Public — verifies an onboarding token and returns prefilled clinic data.
   * Called by the frontend on the welcome screen to pre-fill the form.
   *
   * Always returns { valid } — never throws 404.
   * Output (valid):   { valid: true, type, clinicName, adminEmail }
   * Output (invalid): { valid: false, reason: "expired" | "used" | "not_found" }
   */
  @Get('verify/:token')
  @Public()
  @ApiOperation({ summary: '[Shared] Verify an onboarding token — works for both clinic and lab (public, no auth)' })
  verifyOnboardingToken(@Param('token') token: string) {
    return this.onboardingService.verifyOnboardingToken(token);
  }

  /**
   * Public — completes ADMIN onboarding. Token is the only credential.
   * Creates: Supabase Auth user → local User row → Tenant → ADMIN membership.
   * Marks the token as used. After this the admin can log in with email + password.
   *
   * Accepts multipart/form-data when a logo file is included (field name: "logo"),
   * or application/json when no logo is provided.
   *
   * Input:  { token, firstName, lastName, password, phone?, logo? (file) }
   * Output: { tenantId, userId }
   */
  @Post('complete')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('logo'))
  @ApiOperation({
    summary: '[Clinic] Complete clinic admin onboarding and create clinic account (public, no auth)',
  })
  @ApiConsumes('multipart/form-data', 'application/json')
  completeAdminOnboarding(
    @Body() body: CompleteAdminOnboardingDto,
    @UploadedFile() logo?: Express.Multer.File
  ) {
    return this.onboardingService.completeAdminOnboarding(body, logo);
  }

  // ── Lab onboarding endpoints ──────────────────────────────────────────────

  @Post('lab-link')
  @Public()
  @UseGuards(InternalApiKeyGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: '[Lab] Create a lab admin onboarding link (internal, x-api-key)',
  })
  @ApiHeader({
    name: 'x-internal-api-key',
    description: 'Internal API key for internal-only endpoints',
    required: true,
  })
  createLabLink(@Body() body: CreateLabLinkDto) {
    return this.onboardingService.createLabLink(body);
  }

  @Post('complete-lab')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: '[Lab] Complete lab admin onboarding and create laboratory account (public, no auth)',
  })
  completeLabOnboarding(@Body() body: CompleteLabOnboardingDto) {
    return this.onboardingService.completeLabOnboarding(body);
  }

  // ── Lab management (internal) ─────────────────────────────────────────────

  @Get('labs')
  @Public()
  @UseGuards(InternalApiKeyGuard)
  @ApiOperation({
    summary: '[Lab] List all lab tenants (internal, x-api-key)',
  })
  @ApiHeader({
    name: 'x-internal-api-key',
    description: 'Internal API key for internal-only endpoints',
    required: true,
  })
  listLabs() {
    return this.onboardingService.listLabs();
  }

  @Delete('lab')
  @Public()
  @UseGuards(InternalApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[Lab] Delete a lab tenant and all associated data (internal, x-api-key)',
  })
  @ApiHeader({
    name: 'x-internal-api-key',
    description: 'Internal API key for internal-only endpoints',
    required: true,
  })
  deleteLab(@Body() body: DeleteLabDto) {
    return this.onboardingService.deleteLab(body.tenantId);
  }
}
