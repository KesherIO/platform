import { randomUUID } from 'node:crypto';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { OrderAttentionService } from '../lab/order-attention.service';
import { KnowledgeSearchService } from '../rag/knowledge-search.service';
import { McpToolContext } from './mcp-tool-context';
import { registerTools } from './tools/register-tools';

interface SessionEntry {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  context: McpToolContext;
  lastActivityAt: number;
}

export type SessionVerification =
  | { ok: true }
  | { ok: false; reason: 'UNKNOWN_SESSION' | 'IDENTITY_MISMATCH' };

const SWEEP_INTERVAL_MS = 60_000;

/**
 * In-memory only — works for a single API instance, or behind a load balancer
 * with sticky sessions on `mcp-session-id`. A production deployment would move
 * this state to Redis; documented as an explicit MVP limitation, not fixed here.
 */
@Injectable()
export class McpSessionManager implements OnModuleDestroy {
  private readonly logger = new Logger(McpSessionManager.name);
  private readonly sessions = new Map<string, SessionEntry>();
  private readonly sweepTimer: ReturnType<typeof setInterval>;

  constructor(
    private readonly config: ConfigService,
    private readonly orderAttentionService: OrderAttentionService,
    private readonly knowledgeSearchService: KnowledgeSearchService
  ) {
    this.sweepTimer = setInterval(
      () => this.evictIdleSessions(),
      SWEEP_INTERVAL_MS
    );
  }

  onModuleDestroy(): void {
    clearInterval(this.sweepTimer);
    for (const sessionId of [...this.sessions.keys()]) {
      this.destroySession(sessionId);
    }
  }

  get(sessionId: string): SessionEntry | undefined {
    return this.sessions.get(sessionId);
  }

  touch(sessionId: string): void {
    const entry = this.sessions.get(sessionId);
    if (entry) entry.lastActivityAt = Date.now();
  }

  /**
   * Defense in depth: even though a session was only ever created under a
   * guarded request, re-verify on every subsequent request that BOTH the
   * freshly-authenticated userId and tenantId still match what was bound at
   * session creation. Neither field ever comes from tool input.
   */
  verifyIdentity(
    sessionId: string,
    context: McpToolContext
  ): SessionVerification {
    const entry = this.sessions.get(sessionId);
    if (!entry) return { ok: false, reason: 'UNKNOWN_SESSION' };
    if (
      entry.context.userId !== context.userId ||
      entry.context.tenantId !== context.tenantId
    ) {
      return { ok: false, reason: 'IDENTITY_MISMATCH' };
    }
    return { ok: true };
  }

  async createSession(
    context: McpToolContext
  ): Promise<StreamableHTTPServerTransport> {
    const maxSessions = this.config.get<number>('MCP_MAX_SESSIONS', 100);
    if (this.sessions.size >= maxSessions) {
      throw new Error('Maximum number of concurrent MCP sessions reached.');
    }

    // `server` is referenced inside the transport's closures below before its
    // own declaration is reached — safe, since those closures only run later
    // (on an actual request), well after `server` has been assigned.
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        this.sessions.set(sessionId, {
          transport,
          server,
          context,
          lastActivityAt: Date.now(),
        });
        this.logger.log(
          `session created sessionId=${sessionId} tenantId=${context.tenantId} userId=${context.userId}`
        );
      },
      onsessionclosed: (sessionId) => {
        this.destroySession(sessionId);
      },
    });

    const server = new McpServer({
      name: 'vet-ai-lab-assistant',
      version: '0.1.0',
    });
    registerTools(server, context, {
      orderAttentionService: this.orderAttentionService,
      knowledgeSearchService: this.knowledgeSearchService,
    });

    await server.connect(transport);
    return transport;
  }

  private evictIdleSessions(): void {
    const idleMs =
      this.config.get<number>('MCP_SESSION_IDLE_MINUTES', 30) * 60_000;
    const now = Date.now();
    for (const [sessionId, entry] of this.sessions) {
      if (now - entry.lastActivityAt > idleMs) {
        this.logger.log(`evicting idle session sessionId=${sessionId}`);
        this.destroySession(sessionId);
      }
    }
  }

  private destroySession(sessionId: string): void {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    this.sessions.delete(sessionId);
    entry.server
      .close()
      .catch((err) =>
        this.logger.warn(
          `error closing MCP server for session ${sessionId}: ${err}`
        )
      );
    entry.transport
      .close()
      .catch((err) =>
        this.logger.warn(
          `error closing MCP transport for session ${sessionId}: ${err}`
        )
      );
  }
}
