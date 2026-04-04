import { Controller, Get, Post, HttpCode, HttpStatus } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import type { AuthenticatedUser } from '@vet-ai/shared-types';

@ApiTags('auth')
@ApiBearerAuth()
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Bootstrap endpoint — Angular calls this after Supabase login to get the
   * full user profile, tenant memberships, and role in one request.
   */
  @Get('me')
  @ApiOperation({ summary: 'Get current user profile and tenant memberships' })
  @ApiOkResponse({ description: 'User profile with tenant memberships' })
  getMe(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.getMe(user.id);
  }

  /**
   * Invalidates the user's Supabase session server-side.
   * The client also calls supabase.auth.signOut() to clear local storage.
   */
  @Post('sign-out')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Sign out — invalidate session server-side' })
  async signOut(@CurrentUser() user: AuthenticatedUser) {
    await this.authService.signOut(user.id);
  }

  /**
   * Lightweight check — returns 200 if JWT is valid, 401 otherwise.
   */
  @Get('verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify JWT token is valid' })
  verify(@CurrentUser() user: AuthenticatedUser) {
    return { valid: true, userId: user.id };
  }

  /**
   * Public health check — not protected.
   */
  @Get('health')
  @Public()
  @ApiOperation({ summary: 'Auth service health check (public)' })
  health() {
    return { status: 'ok' };
  }
}
