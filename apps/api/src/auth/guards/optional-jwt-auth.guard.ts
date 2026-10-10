import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthenticatedUser } from '@vet-ai/shared-types';

/**
 * For @Public() routes that behave differently when the caller is signed in.
 * Verifies the Supabase JWT like JwtAuthGuard, but never rejects: a missing,
 * expired or invalid token leaves request.user as null.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  override handleRequest<TUser = AuthenticatedUser | null>(
    _err: unknown,
    user: TUser | false
  ): TUser {
    return (user || null) as TUser;
  }
}
