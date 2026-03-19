import { Injectable } from '@nestjs/common';

@Injectable()
export class AuthService {
  // TODO: Integrate with Supabase/Auth0 JWT verification
  login(): { message: string } {
    return { message: 'TODO: implement auth' };
  }

  logout(): void {
    // TODO: invalidate session/token
  }
}