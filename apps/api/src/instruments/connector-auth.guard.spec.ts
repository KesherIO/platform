import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConnectorAuthGuard } from './connector-auth.guard';
import type { ConnectorCredentialService } from './connector-credential.service';

const ctx = (
  headers: Record<string, string>,
  request: Record<string, unknown> = {}
) => {
  const req = { headers, ip: '10.0.0.5', ...request };
  return {
    req,
    context: {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext,
  };
};

describe('ConnectorAuthGuard', () => {
  const connector = {
    credentialId: 'c1',
    credentialName: 'n',
    labTenantId: 'lab1',
    analyzerId: 'an1',
    analyzerName: 'VH30',
  };
  const authenticate = jest.fn();
  const guard = new ConnectorAuthGuard({
    authenticate,
  } as unknown as ConnectorCredentialService);
  beforeEach(() => authenticate.mockReset());

  it("binds the request to the credential's lab and analyzer", async () => {
    authenticate.mockResolvedValue(connector);
    const { req, context } = ctx({ authorization: 'Bearer kvc_abc' });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(authenticate).toHaveBeenCalledWith('kvc_abc', '10.0.0.5');
    expect((req as { connector?: unknown }).connector).toBe(connector);
  });

  it.each([
    [{}],
    [{ authorization: 'Basic abc' }],
    [{ authorization: 'Bearer' }],
  ])('refuses a missing/malformed header %j', async (headers) => {
    authenticate.mockResolvedValue(null);
    await expect(guard.canActivate(ctx(headers).context)).rejects.toThrow(
      UnauthorizedException
    );
    expect(authenticate).toHaveBeenCalledWith(undefined, '10.0.0.5');
  });

  it('refuses an unknown or revoked token with 401', async () => {
    authenticate.mockResolvedValue(null);
    await expect(
      guard.canActivate(ctx({ authorization: 'Bearer kvc_revoked' }).context)
    ).rejects.toThrow(UnauthorizedException);
  });
});
