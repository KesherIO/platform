import { TenantRole } from '@vet-ai/shared-types';
import { McpController } from './mcp.controller';
import { McpSessionManager } from './mcp-session.manager';

const USER = { id: 'user-a', email: 'a@lab.test' };
const TENANT = {
  tenantId: 'lab-tenant-a',
  tenantName: 'Lab A',
  tenantLogoUrl: null,
  role: TenantRole.ADMIN,
};

function fakeResponse() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function fakeRequest(headers: Record<string, string> = {}, body?: unknown) {
  return { headers, body } as any;
}

describe('McpController', () => {
  let controller: McpController;
  let sessionManager: {
    verifyIdentity: jest.Mock;
    touch: jest.Mock;
    get: jest.Mock;
    createSession: jest.Mock;
  };

  beforeEach(() => {
    sessionManager = {
      verifyIdentity: jest.fn(),
      touch: jest.fn(),
      get: jest.fn(),
      createSession: jest.fn(),
    };
    controller = new McpController(
      sessionManager as unknown as McpSessionManager
    );
  });

  it('creates without error', () => {
    expect(controller).toBeDefined();
  });

  it('rejects an unknown mcp-session-id with 404 without touching a transport', async () => {
    sessionManager.verifyIdentity.mockReturnValue({
      ok: false,
      reason: 'UNKNOWN_SESSION',
    });
    const res = fakeResponse();

    await controller.handlePost(
      fakeRequest({ 'mcp-session-id': 'ghost' }, {}),
      res,
      USER as any,
      TENANT as any
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(sessionManager.get).not.toHaveBeenCalled();
  });

  it('rejects a session bound to a different tenant/user with 403', async () => {
    sessionManager.verifyIdentity.mockReturnValue({
      ok: false,
      reason: 'IDENTITY_MISMATCH',
    });
    const res = fakeResponse();

    await controller.handlePost(
      fakeRequest({ 'mcp-session-id': 'stolen' }, {}),
      res,
      USER as any,
      TENANT as any
    );

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('forwards a request for a valid, matching session to its transport', async () => {
    const handleRequest = jest.fn().mockResolvedValue(undefined);
    sessionManager.verifyIdentity.mockReturnValue({ ok: true });
    sessionManager.get.mockReturnValue({ transport: { handleRequest } });
    const res = fakeResponse();
    const req = fakeRequest({ 'mcp-session-id': 'sess-1' }, { jsonrpc: '2.0' });

    await controller.handlePost(req, res, USER as any, TENANT as any);

    expect(sessionManager.touch).toHaveBeenCalledWith('sess-1');
    expect(handleRequest).toHaveBeenCalledWith(req, res, req.body);
  });

  it('rejects a non-initialize request with no session id as 400', async () => {
    const res = fakeResponse();

    await controller.handlePost(
      fakeRequest({}, { jsonrpc: '2.0', method: 'tools/call' }),
      res,
      USER as any,
      TENANT as any
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(sessionManager.createSession).not.toHaveBeenCalled();
  });

  it('creates a new session for a fresh initialize request with no session id', async () => {
    const handleRequest = jest.fn().mockResolvedValue(undefined);
    sessionManager.createSession.mockResolvedValue({ handleRequest });
    const res = fakeResponse();
    const initializeBody = {
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      },
      id: 1,
    };
    const req = fakeRequest({}, initializeBody);

    await controller.handlePost(req, res, USER as any, TENANT as any);

    expect(sessionManager.createSession).toHaveBeenCalledWith({
      userId: 'user-a',
      tenantId: 'lab-tenant-a',
      tenantName: 'Lab A',
      role: TenantRole.ADMIN,
    });
    expect(handleRequest).toHaveBeenCalledWith(req, res, initializeBody);
  });

  it('returns 503 if the session manager rejects creation (session cap reached)', async () => {
    sessionManager.createSession.mockRejectedValue(
      new Error('Maximum number of concurrent MCP sessions reached.')
    );
    const res = fakeResponse();
    const initializeBody = {
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      },
      id: 1,
    };

    await controller.handlePost(
      fakeRequest({}, initializeBody),
      res,
      USER as any,
      TENANT as any
    );

    expect(res.status).toHaveBeenCalledWith(503);
  });
});
