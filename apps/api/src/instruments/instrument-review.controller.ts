import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuthenticatedUser, TenantContext } from '@vet-ai/shared-types';
import { TenantRole } from '@vet-ai/shared-types';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { LAB_RELEASE_ROLES, LAB_STAFF_ROLES } from '../lab/lab-roles';
import { LabTenantGuard } from '../lab/lab-tenant.guard';
import { ConnectorCredentialService } from './connector-credential.service';
import {
  ApproveDto,
  CreateCredentialDto,
  CreateSampleLinkDto,
  DismissDto,
  ResolveSampleDto,
  UpsertMappingDto,
} from './dto/instruments.dto';
import { InstrumentReviewService, type QueueView } from './instrument-review.service';

const ADMIN_ROLES = [TenantRole.ADMIN, TenantRole.OWNER];
const actorName = (u: AuthenticatedUser) => [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email;
const VIEWS: QueueView[] = ['review', 'incomplete', 'attention', 'all'];

/** Lab staff: the analyzer review queue, sample links, parameter mappings, connector credentials. */
@ApiTags('Lab · Instruments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, LabTenantGuard)
@Controller('lab/instruments')
export class InstrumentReviewController {
  constructor(
    private readonly review: InstrumentReviewService,
    private readonly credentials: ConnectorCredentialService
  ) {}

  // ── Review queue ─────────────────────────────────────────────────────────

  @Get('summary')
  @Roles(...LAB_STAFF_ROLES)
  summary(@CurrentTenant() t: TenantContext) {
    return this.review.summary(t.tenantId);
  }

  @Get('messages')
  @Roles(...LAB_STAFF_ROLES)
  list(
    @CurrentTenant() t: TenantContext,
    @Query('view') view = 'attention',
    @Query('take', new ParseIntPipe({ optional: true })) take?: number,
    @Query('cursor') cursor?: string
  ) {
    return this.review.list(t.tenantId, VIEWS.includes(view as QueueView) ? (view as QueueView) : 'attention', take, cursor);
  }

  @Get('messages/:id')
  @Roles(...LAB_STAFF_ROLES)
  get(@CurrentTenant() t: TenantContext, @Param('id') id: string) {
    return this.review.get(t.tenantId, id);
  }

  @Get('messages/:id/raw')
  @Roles(...LAB_STAFF_ROLES)
  async raw(@CurrentTenant() t: TenantContext, @Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const { bytes, fileName } = await this.review.raw(t.tenantId, id);
    res.set({ 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${fileName}"` });
    return new StreamableFile(bytes);
  }

  @Post('messages/:id/resolve-sample')
  @Roles(...LAB_STAFF_ROLES)
  @HttpCode(HttpStatus.OK)
  resolveSample(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ResolveSampleDto
  ) {
    return this.review.resolveSample(t.tenantId, id, dto.orderId, user.id);
  }

  @Post('messages/:id/reprocess')
  @Roles(...LAB_STAFF_ROLES)
  @HttpCode(HttpStatus.OK)
  reprocess(@CurrentTenant() t: TenantContext, @Param('id') id: string) {
    return this.review.reprocess(t.tenantId, id);
  }

  /** Accepting a changed result / expired reagent is a quality decision: reviewers and above. */
  @Post('messages/:id/approve')
  @Roles(...LAB_RELEASE_ROLES)
  @HttpCode(HttpStatus.OK)
  approve(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ApproveDto
  ) {
    return this.review.approve(t.tenantId, id, { id: user.id, name: actorName(user) }, dto.reasons, dto.note);
  }

  @Post('messages/:id/dismiss')
  @Roles(...LAB_STAFF_ROLES)
  @HttpCode(HttpStatus.OK)
  dismiss(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: DismissDto
  ) {
    return this.review.dismiss(t.tenantId, id, user.id, dto.note);
  }

  // ── Sample links ─────────────────────────────────────────────────────────

  @Get('sample-links')
  @Roles(...LAB_STAFF_ROLES)
  listLinks(@CurrentTenant() t: TenantContext, @Query('analyzerId') analyzerId?: string, @Query('orderId') orderId?: string) {
    return this.review.listLinks(t.tenantId, { ...(analyzerId && { analyzerId }), ...(orderId && { orderId }) });
  }

  @Post('sample-links')
  @Roles(...LAB_STAFF_ROLES)
  createLink(@CurrentTenant() t: TenantContext, @CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSampleLinkDto) {
    return this.review.createLink(t.tenantId, dto, user.id);
  }

  @Post('sample-links/:id/end')
  @Roles(...LAB_STAFF_ROLES)
  @HttpCode(HttpStatus.OK)
  endLink(@CurrentTenant() t: TenantContext, @Param('id') id: string) {
    return this.review.endLink(t.tenantId, id);
  }

  // ── Parameter mappings ───────────────────────────────────────────────────

  @Get('mappings')
  @Roles(...LAB_STAFF_ROLES)
  listMappings(@CurrentTenant() t: TenantContext, @Query('analyzerId') analyzerId?: string) {
    return this.review.listMappings(t.tenantId, analyzerId);
  }

  @Put('mappings')
  @Roles(...ADMIN_ROLES)
  upsertMapping(@CurrentTenant() t: TenantContext, @Body() dto: UpsertMappingDto) {
    return this.review.upsertMapping(t.tenantId, dto);
  }

  @Delete('mappings/:id')
  @Roles(...ADMIN_ROLES)
  deleteMapping(@CurrentTenant() t: TenantContext, @Param('id') id: string) {
    return this.review.deleteMapping(t.tenantId, id);
  }

  // ── Connector credentials ────────────────────────────────────────────────

  @Get('credentials')
  @Roles(...ADMIN_ROLES)
  listCredentials(@CurrentTenant() t: TenantContext) {
    return this.credentials.list(t.tenantId);
  }

  /** The token is in this response only. Store it in the connector; it cannot be shown again. */
  @Post('credentials')
  @Roles(...ADMIN_ROLES)
  createCredential(@CurrentTenant() t: TenantContext, @CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCredentialDto) {
    return this.credentials.create(t.tenantId, dto.analyzerId, dto.name, user.id);
  }

  @Post('credentials/:id/revoke')
  @Roles(...ADMIN_ROLES)
  @HttpCode(HttpStatus.OK)
  revokeCredential(@CurrentTenant() t: TenantContext, @CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.credentials.revoke(t.tenantId, id, user.id);
  }
}
