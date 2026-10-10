import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard';

describe('OptionalJwtAuthGuard', () => {
  const guard = new OptionalJwtAuthGuard();
  const user = { id: 'user-1', email: 'jane@cityvet.com' };

  it('returns the verified user when the token is valid', () => {
    expect(guard.handleRequest(null, user)).toBe(user);
  });

  it('returns null instead of throwing when there is no valid token', () => {
    expect(guard.handleRequest(null, false)).toBeNull();
    expect(guard.handleRequest(new Error('jwt expired'), false)).toBeNull();
  });
});
