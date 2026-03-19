import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // TODO: Integrate with Supabase/Auth0
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() _body: { email: string; password: string }) {
    return this.authService.login();
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout() {
    return this.authService.logout();
  }
}