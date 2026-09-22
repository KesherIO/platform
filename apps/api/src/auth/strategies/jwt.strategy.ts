import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { passportJwtSecret } from 'jwks-rsa';
import { JwtPayload, AuthenticatedUser } from '@vet-ai/shared-types';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    const supabaseUrl = config.getOrThrow<string>('SUPABASE_URL');

    // Supabase uses ES256 (asymmetric) — verify against the public JWKS endpoint,
    // not the JWT secret (which is only used for HS256 legacy projects).
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKeyProvider: passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 10,
        jwksUri: `${supabaseUrl}/auth/v1/.well-known/jwks.json`,
      }),
      audience: 'authenticated',
      issuer: `${supabaseUrl}/auth/v1`,
      algorithms: ['ES256'],
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    // JWT is already cryptographically verified by passport-jwt + jwks-rsa.
    // Avoid a DB round-trip on every request — trust the verified payload.
    // firstName/lastName come from user_metadata set at account creation;
    // profile updates (via /auth/me) sync to the DB but not Supabase metadata,
    // so audit-trail names may lag until the token is refreshed (~1h).
    return {
      id: payload.sub,
      email: payload.email,
      firstName: payload.user_metadata?.first_name ?? null,
      lastName: payload.user_metadata?.last_name ?? null,
    };
  }
}
