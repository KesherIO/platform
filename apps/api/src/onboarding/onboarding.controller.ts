import { Controller, Post, Body, Get, Param } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';

@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Get(':tenantId/branding')
  getBranding(@Param('tenantId') tenantId: string) {
    return this.onboardingService.getBranding(tenantId);
  }

  @Post('clinic')
  saveClinic(@Body() _body: unknown) {
    return this.onboardingService.saveClinic();
  }

  @Post('admin-profile')
  saveAdminProfile(@Body() _body: unknown) {
    return this.onboardingService.saveAdminProfile();
  }

  @Post('staff-profile')
  saveStaffProfile(@Body() _body: unknown) {
    return this.onboardingService.saveStaffProfile();
  }

  @Post('invite')
  generateInvite(@Body() _body: unknown) {
    return this.onboardingService.generateInvite();
  }
}