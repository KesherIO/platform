import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Query,
  UploadedFile,
  UseInterceptors,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { OnboardingService } from './onboarding.service';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '@vet-ai/shared-types';
import {
  SaveStaffProfileDto,
  GenerateInviteDto,
  CreateAdminLinkDto,
  CompleteAdminOnboardingDto,
} from './dto/onboarding.dto';

@ApiTags('onboarding')
@ApiBearerAuth()
@Controller('onboarding')
export class OnboardingController {
  constructor(
    private readonly onboardingService: OnboardingService,
  ) {}

  /**
   * Public — fetched before the user has a tenant membership.
   * Used to display clinic branding on the onboarding welcome screen.
   */
  @Get(':tenantId/branding')
  @Public()
  @ApiOperation({ summary: 'Get tenant branding (public)' })
  getBranding(@Param('tenantId') tenantId: string) {
    return this.onboardingService.getBranding(tenantId);
  }

  /**
   * Public — verifies a staff invite token before showing the profile form.
   * Returns tenant branding + invite metadata so the staff screen can render.
   */
  @Get('invite/verify/:token')
  @Public()
  @ApiOperation({ summary: 'Verify a staff invite token (public)' })
  verifyInvite(@Param('token') token: string) {
    return this.onboardingService.verifyInvite(token);
  }

  /**
   * Protected — staff member accepts invite and saves their profile.
   * Token is included in the request body (received via magic link URL).
   * tenantId is passed as a query param.
   */
  @Post('staff-profile')
  @ApiOperation({ summary: 'Save staff profile (invite acceptance)' })
  saveStaffProfile(
    @Body() body: SaveStaffProfileDto,
    @Query('tenantId') tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.onboardingService.saveStaffProfile(user.id, tenantId, body.token, body);
  }

  /**
   * Protected — admin/owner generates a staff invitation token.
   * tenantId is passed as a query param.
   */
  @Post('invite')
  @ApiOperation({ summary: 'Generate a staff invite link' })
  generateInvite(
    @Body() body: GenerateInviteDto,
    @Query('tenantId') tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.onboardingService.generateInvite(user.id, tenantId, body);
  }

  // ── New token-based admin onboarding endpoints ────────────────────────────

  /**
   * Public (TODO: protect with internal API key before going to prod) —
   * called by Biomet to create a secure onboarding link for a new clinic admin.
   *
   * Input:  { clinicName, adminEmail, biometClinicId? }
   * Output: { token, onboardingLink: "/onboarding/welcome?token=<hex>" }
   */
  @Post('admin-link')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create an ADMIN onboarding link (Biomet internal use)' })
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
  @ApiOperation({ summary: 'Verify an onboarding token (public)' })
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
  @ApiOperation({ summary: 'Complete ADMIN onboarding and create clinic account' })
  @ApiConsumes('multipart/form-data', 'application/json')
  completeAdminOnboarding(
    @Body() body: CompleteAdminOnboardingDto,
    @UploadedFile() logo?: Express.Multer.File,
  ) {
    return this.onboardingService.completeAdminOnboarding(body, logo);
  }
}