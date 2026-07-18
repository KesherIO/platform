import {
  Controller,
  Delete,
  Get,
  Logger,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { LabTenantGuard } from '../lab/lab-tenant.guard';
import type { AuthenticatedUser, TenantContext } from '@vet-ai/shared-types';
import { McpSessionManager } from './mcp-session.manager';
import { McpToolContext } from './mcp-tool-context';

const SESSION_HEADER = 'mcp-session-id';

/**
 * Remote MCP server, mounted behind the same guards as the rest of the lab
 * API. Every request here — initialize, each tool call, teardown — passes
 * through JwtAuthGuard + LabTenantGuard before this controller runs; there is
 * no path that bypasses that check to reach the transport.
 */
@Controller('mcp')
export class McpController {
  private readonly logger = new Logger(McpController.name);

  constructor(private readonly sessionManager: McpSessionManager) {}

  @UseGuards(JwtAuthGuard, LabTenantGuard)
  @Post()
  async handlePost(
    @Req() req: Request,
    @Res({ passthrough: false }) res: Response,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTenant() tenant: TenantContext
  ): Promise<void> {
    await this.dispatch(req, res, req.body, user, tenant);
  }

  @UseGuards(JwtAuthGuard, LabTenantGuard)
  @Get()
  async handleGet(
    @Req() req: Request,
    @Res({ passthrough: false }) res: Response,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTenant() tenant: TenantContext
  ): Promise<void> {
    await this.dispatch(req, res, undefined, user, tenant);
  }

  @UseGuards(JwtAuthGuard, LabTenantGuard)
  @Delete()
  async handleDelete(
    @Req() req: Request,
    @Res({ passthrough: false }) res: Response,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTenant() tenant: TenantContext
  ): Promise<void> {
    await this.dispatch(req, res, undefined, user, tenant);
  }

  private async dispatch(
    req: Request,
    res: Response,
    body: unknown,
    user: AuthenticatedUser,
    tenant: TenantContext
  ): Promise<void> {
    const context: McpToolContext = {
      userId: user.id,
      tenantId: tenant.tenantId,
      tenantName: tenant.tenantName,
      role: tenant.role,
    };
    const sessionId = req.headers[SESSION_HEADER] as string | undefined;

    if (sessionId) {
      const verification = this.sessionManager.verifyIdentity(
        sessionId,
        context
      );
      if (!verification.ok) {
        const status = verification.reason === 'UNKNOWN_SESSION' ? 404 : 403;
        this.logger.warn(
          `rejected sessionId=${sessionId} reason=${verification.reason} userId=${user.id} tenantId=${tenant.tenantId}`
        );
        res.status(status).json({ error: verification.reason });
        return;
      }

      this.sessionManager.touch(sessionId);
      const transport = this.sessionManager.get(sessionId)
        ?.transport as StreamableHTTPServerTransport;
      await transport.handleRequest(req, res, body);
      return;
    }

    if (!isInitializeRequest(body)) {
      res.status(400).json({
        error: `Missing ${SESSION_HEADER} header for a non-initialize request.`,
      });
      return;
    }

    let transport: StreamableHTTPServerTransport;
    try {
      transport = await this.sessionManager.createSession(context);
    } catch (err) {
      this.logger.error(`session creation failed: ${(err as Error).message}`);
      res.status(503).json({
        error: 'Too many active MCP sessions. Try again shortly.',
      });
      return;
    }

    await transport.handleRequest(req, res, body);
  }
}
