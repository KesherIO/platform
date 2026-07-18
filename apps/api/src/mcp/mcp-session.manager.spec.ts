import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TenantRole } from '@vet-ai/shared-types';
import { McpSessionManager } from './mcp-session.manager';
import { OrderAttentionService } from '../lab/order-attention.service';
import { KnowledgeSearchService } from '../rag/knowledge-search.service';
import { McpToolContext } from './mcp-tool-context';

const CONTEXT_A: McpToolContext = {
  userId: 'user-a',
  tenantId: 'lab-tenant-a',
  tenantName: 'Lab A',
  role: TenantRole.ADMIN,
};

const CONTEXT_B: McpToolContext = {
  userId: 'user-b',
  tenantId: 'lab-tenant-b',
  tenantName: 'Lab B',
  role: TenantRole.ADMIN,
};

describe('McpSessionManager', () => {
  let manager: McpSessionManager;
  let configGet: jest.Mock;

  beforeEach(async () => {
    configGet = jest.fn((_key: string, defaultValue?: number) => defaultValue);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        McpSessionManager,
        { provide: ConfigService, useValue: { get: configGet } },
        { provide: OrderAttentionService, useValue: {} },
        { provide: KnowledgeSearchService, useValue: {} },
      ],
    }).compile();

    manager = module.get(McpSessionManager);
  });

  afterEach(() => {
    manager.onModuleDestroy();
  });

  it('creates without error', () => {
    expect(manager).toBeDefined();
  });

  it('reports an unknown sessionId as UNKNOWN_SESSION', () => {
    const result = manager.verifyIdentity('does-not-exist', CONTEXT_A);
    expect(result).toEqual({ ok: false, reason: 'UNKNOWN_SESSION' });
  });

  it('rejects a session when the tenantId no longer matches (session hijack attempt)', async () => {
    const transport = await manager.createSession(CONTEXT_A);
    // The transport only registers itself in the map once a real MCP
    // `initialize` request flows through it and fires onsessioninitialized —
    // simulate that here without a live transport handshake.
    const sessionId = 'sess-1';
    (manager as any).sessions.set(sessionId, {
      transport,
      server: { close: jest.fn().mockResolvedValue(undefined) },
      context: CONTEXT_A,
      lastActivityAt: Date.now(),
    });

    const result = manager.verifyIdentity(sessionId, CONTEXT_B);

    expect(result).toEqual({ ok: false, reason: 'IDENTITY_MISMATCH' });
  });

  it('accepts a session when both userId and tenantId match', async () => {
    const transport = await manager.createSession(CONTEXT_A);
    const sessionId = 'sess-2';
    (manager as any).sessions.set(sessionId, {
      transport,
      server: { close: jest.fn().mockResolvedValue(undefined) },
      context: CONTEXT_A,
      lastActivityAt: Date.now(),
    });

    const result = manager.verifyIdentity(sessionId, CONTEXT_A);

    expect(result).toEqual({ ok: true });
  });

  it('rejects new sessions once the configured max is reached', async () => {
    configGet.mockImplementation((key: string, defaultValue?: number) =>
      key === 'MCP_MAX_SESSIONS' ? 0 : defaultValue
    );

    await expect(manager.createSession(CONTEXT_A)).rejects.toThrow(
      /Maximum number of concurrent MCP sessions/
    );
  });
});
