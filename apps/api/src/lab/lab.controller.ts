import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { InternalApiKeyGuard } from '../auth/guards/internal-api-key.guard';
import { LabTenantGuard } from './lab-tenant.guard';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { TenantRole } from '@vet-ai/shared-types';
import type { TenantContext, AuthenticatedUser } from '@vet-ai/shared-types';
import { LabService } from './lab.service';
import { LabUsersService } from './lab-users.service';
import { LabClientsService } from './lab-clients.service';
import { PickupService } from './pickup.service';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { UpdateOrderedTestDto } from './dto/update-ordered-test.dto';
import { UpsertLaboratoryProfileDto } from './dto/upsert-laboratory-profile.dto';
import { UpdateLabContactDto } from './dto/update-lab-contact.dto';
import { CreateLabUserDto } from './dto/create-lab-user.dto';
import { UpdateLabUserRoleDto } from './dto/update-lab-user-role.dto';
import { UpdateLabUserDto } from './dto/update-lab-user.dto';
import { ListLabOrdersDto } from './dto/list-lab-orders.dto';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { ListClientsDto } from './dto/list-clients.dto';
import { ListPickupsDto } from './dto/list-pickups.dto';
import { AssignMessengerDto } from './dto/assign-messenger.dto';
import { CancelPickupDto } from './dto/cancel-pickup.dto';
import { ReportPickupProblemDto } from './dto/report-pickup-problem.dto';
import { SavePushSubscriptionDto } from './dto/save-push-subscription.dto';
import { UpdateCollectionSettingsDto } from './dto/update-collection-settings.dto';

@Controller('lab')
export class LabController {
  constructor(
    private readonly labService: LabService,
    private readonly labUsersService: LabUsersService,
    private readonly labClientsService: LabClientsService,
    private readonly pickupService: PickupService
  ) {}

  // ---------------------------------------------------------------------------
  // Bootstrap — first lab admin, no JWT required, internal API key only
  // POST /api/lab/setup
  // ---------------------------------------------------------------------------

  @Public()
  @UseGuards(InternalApiKeyGuard)
  @Post('setup')
  setup(
    @Query('labTenantId') labTenantId: string,
    @Body() dto: CreateLabUserDto
  ) {
    return this.labUsersService.bootstrapAdmin(labTenantId, dto);
  }

  // ---------------------------------------------------------------------------
  // All routes below require a valid JWT + lab tenant membership
  // ---------------------------------------------------------------------------

  // GET /api/lab/me
  @UseGuards(JwtAuthGuard, LabTenantGuard)
  @Get('me')
  getMe(@CurrentTenant() tenant: TenantContext) {
    return {
      role: tenant.role,
      tenantName: tenant.tenantName,
      logoUrl: tenant.tenantLogoUrl,
      canPerformPickups: tenant.canPerformPickups,
    };
  }

  // GET /api/lab/orders?status=RECEIVED_BY_LAB&search=luna&dateFrom=2026-08-01&dateTo=2026-08-08&page=1&pageSize=20
  @UseGuards(JwtAuthGuard, LabTenantGuard)
  @Get('orders')
  getOrders(
    @CurrentTenant() tenant: TenantContext,
    @Query() query: ListLabOrdersDto
  ) {
    return this.labService.getLabOrders(tenant.tenantId, query);
  }

  // GET /api/lab/orders/:id
  @UseGuards(JwtAuthGuard, LabTenantGuard)
  @Get('orders/:id')
  getOrderById(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string
  ) {
    return this.labService.getLabOrderById(tenant.tenantId, id);
  }

  // PATCH /api/lab/orders/:id/status
  @UseGuards(JwtAuthGuard, LabTenantGuard)
  @Roles(
    TenantRole.RECEPTIONIST,
    TenantRole.TECHNICIAN,
    TenantRole.ADMIN,
    TenantRole.OWNER
  )
  @Patch('orders/:id/status')
  updateOrderStatus(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto
  ) {
    return this.labService.updateOrderStatus(tenant.tenantId, id, dto);
  }

  // POST /api/lab/orders/:id/ordered-tests
  @UseGuards(JwtAuthGuard, LabTenantGuard)
  @Roles(
    TenantRole.RECEPTIONIST,
    TenantRole.TECHNICIAN,
    TenantRole.ADMIN,
    TenantRole.OWNER
  )
  @Post('orders/:id/ordered-tests')
  initOrderedTests(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string
  ) {
    return this.labService.initOrderedTests(tenant.tenantId, id);
  }

  // PATCH /api/lab/ordered-tests/:testId
  @UseGuards(JwtAuthGuard, LabTenantGuard)
  @Roles(TenantRole.TECHNICIAN, TenantRole.ADMIN, TenantRole.OWNER)
  @Patch('ordered-tests/:testId')
  updateOrderedTest(
    @CurrentTenant() tenant: TenantContext,
    @Param('testId') testId: string,
    @Body() dto: UpdateOrderedTestDto
  ) {
    return this.labService.updateOrderedTest(tenant.tenantId, testId, dto);
  }

  // PATCH /api/lab/ordered-tests/:testId/receive
  @UseGuards(JwtAuthGuard, LabTenantGuard)
  @Roles(
    TenantRole.RECEPTIONIST,
    TenantRole.TECHNICIAN,
    TenantRole.ADMIN,
    TenantRole.OWNER
  )
  @Patch('ordered-tests/:testId/receive')
  receiveOrderedTest(
    @CurrentTenant() tenant: TenantContext,
    @Param('testId') testId: string
  ) {
    return this.labService.receiveOrderedTest(tenant.tenantId, testId);
  }

  // POST /api/lab/orders/:id/receive-all
  @UseGuards(JwtAuthGuard, LabTenantGuard)
  @Roles(
    TenantRole.RECEPTIONIST,
    TenantRole.TECHNICIAN,
    TenantRole.ADMIN,
    TenantRole.OWNER
  )
  @Post('orders/:id/receive-all')
  @HttpCode(HttpStatus.OK)
  receiveAllOrderedTests(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string
  ) {
    return this.labService.receiveAllOrderedTests(tenant.tenantId, id);
  }

  // GET /api/lab/settings/laboratory
  @UseGuards(JwtAuthGuard, LabTenantGuard)
  @Get('settings/laboratory')
  getLaboratoryProfile(@CurrentTenant() tenant: TenantContext) {
    return this.labService.getLaboratoryProfile(tenant.tenantId);
  }

  // PATCH /api/lab/settings/laboratory
  @UseGuards(JwtAuthGuard, LabTenantGuard)
  @Roles(TenantRole.ADMIN, TenantRole.OWNER)
  @Patch('settings/laboratory')
  upsertLaboratoryProfile(
    @CurrentTenant() tenant: TenantContext,
    @Body() body: UpsertLaboratoryProfileDto
  ) {
    return this.labService.upsertLaboratoryProfile(tenant.tenantId, body);
  }

  // GET /api/lab/settings/contact
  @UseGuards(JwtAuthGuard, LabTenantGuard)
  @Get('settings/contact')
  getLabContact(@CurrentTenant() tenant: TenantContext) {
    return this.labService.getLabContact(tenant.tenantId);
  }

  // PATCH /api/lab/settings/contact
  @UseGuards(JwtAuthGuard, LabTenantGuard)
  @Roles(TenantRole.ADMIN, TenantRole.OWNER)
  @Patch('settings/contact')
  updateLabContact(
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: UpdateLabContactDto
  ) {
    return this.labService.updateLabContact(tenant.tenantId, dto);
  }

  // ---------------------------------------------------------------------------
  // Sample collection & pickup workflow
  // ---------------------------------------------------------------------------

  // GET /api/lab/pickups?status=REQUESTED&search=luna&messengerId=...&dateFrom=2026-08-01&dateTo=2026-08-08&page=1&pageSize=20
  @UseGuards(JwtAuthGuard, LabTenantGuard)
  @Get('pickups')
  listPickups(
    @CurrentTenant() tenant: TenantContext,
    @Query() query: ListPickupsDto
  ) {
    return this.pickupService.listPickups(tenant.tenantId, query);
  }

  // GET /api/lab/pickups/unassigned-count
  @UseGuards(JwtAuthGuard, LabTenantGuard)
  @Get('pickups/unassigned-count')
  async getUnassignedPickupCount(@CurrentTenant() tenant: TenantContext) {
    const { total } = await this.pickupService.listPickups(tenant.tenantId, {
      status: 'REQUESTED',
      pageSize: 1,
    });
    return { count: total };
  }

  // GET /api/lab/my-pickups — the current user's own assigned pickups.
  // No status filter = active pickups only; pass status=RECEIVED_AT_LAB,CANCELLED,FAILED for history.
  @UseGuards(JwtAuthGuard, LabTenantGuard)
  @Get('my-pickups')
  getMyPickups(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListPickupsDto
  ) {
    return this.pickupService.getMyPickups(tenant.tenantId, user.id, query);
  }

  // GET /api/lab/pickups/:id
  @UseGuards(JwtAuthGuard, LabTenantGuard)
  @Get('pickups/:id')
  getPickupById(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string
  ) {
    return this.pickupService.getPickupById(tenant.tenantId, id);
  }

  // POST /api/lab/pickups/:id/assign
  @UseGuards(JwtAuthGuard, LabTenantGuard)
  @Roles(TenantRole.ADMIN, TenantRole.OWNER)
  @Post('pickups/:id/assign')
  assignMessenger(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AssignMessengerDto
  ) {
    return this.pickupService.assignMessenger(
      tenant.tenantId,
      id,
      dto.messengerId,
      user.id
    );
  }

  // POST /api/lab/pickups/:id/received — lab staff confirms the sample arrived
  @UseGuards(JwtAuthGuard, LabTenantGuard)
  @Post('pickups/:id/received')
  @HttpCode(HttpStatus.OK)
  confirmPickupReceived(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string
  ) {
    return this.pickupService.confirmReceived(tenant.tenantId, id, user.id);
  }

  // POST /api/lab/pickups/:id/cancel
  @UseGuards(JwtAuthGuard, LabTenantGuard)
  @Post('pickups/:id/cancel')
  @HttpCode(HttpStatus.OK)
  cancelPickup(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CancelPickupDto
  ) {
    return this.pickupService.cancelPickup(
      tenant.tenantId,
      id,
      user.id,
      dto.reason
    );
  }

  // POST /api/lab/pickups/:id/accept — messenger accepts their assigned pickup
  @UseGuards(JwtAuthGuard, LabTenantGuard)
  @Post('pickups/:id/accept')
  @HttpCode(HttpStatus.OK)
  acceptPickup(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string
  ) {
    return this.pickupService.acceptPickup(tenant.tenantId, id, user.id);
  }

  // POST /api/lab/pickups/:id/collected — messenger marks the sample collected
  @UseGuards(JwtAuthGuard, LabTenantGuard)
  @Post('pickups/:id/collected')
  @HttpCode(HttpStatus.OK)
  markPickupCollected(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string
  ) {
    return this.pickupService.markCollected(tenant.tenantId, id, user.id);
  }

  // POST /api/lab/pickups/:id/problem — messenger reports a collection problem
  @UseGuards(JwtAuthGuard, LabTenantGuard)
  @Post('pickups/:id/problem')
  @HttpCode(HttpStatus.OK)
  reportPickupProblem(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReportPickupProblemDto
  ) {
    return this.pickupService.reportProblem(
      tenant.tenantId,
      id,
      user.id,
      dto.reason,
      dto.details
    );
  }

  // GET /api/lab/messengers
  @UseGuards(JwtAuthGuard, LabTenantGuard)
  @Get('messengers')
  getAvailableMessengers(@CurrentTenant() tenant: TenantContext) {
    return this.pickupService.getAvailableMessengers(tenant.tenantId);
  }

  // POST /api/lab/messengers/me/push-subscription
  @UseGuards(JwtAuthGuard, LabTenantGuard)
  @Post('messengers/me/push-subscription')
  @HttpCode(HttpStatus.OK)
  savePushSubscription(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SavePushSubscriptionDto
  ) {
    return this.pickupService.savePushSubscription(user.id, dto);
  }

  // DELETE /api/lab/messengers/me/push-subscription
  @UseGuards(JwtAuthGuard, LabTenantGuard)
  @Delete('messengers/me/push-subscription')
  @HttpCode(HttpStatus.OK)
  removePushSubscription(
    @CurrentUser() user: AuthenticatedUser,
    @Body('endpoint') endpoint: string
  ) {
    return this.pickupService.removePushSubscription(user.id, endpoint);
  }

  // GET /api/lab/orders/:id/timeline
  @UseGuards(JwtAuthGuard, LabTenantGuard)
  @Get('orders/:id/timeline')
  getOrderTimeline(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string
  ) {
    return this.pickupService.getTimelineForOrder(tenant.tenantId, id);
  }

  // ---------------------------------------------------------------------------
  // User management — ADMIN only
  // ---------------------------------------------------------------------------

  // GET /api/lab/users
  @UseGuards(JwtAuthGuard, LabTenantGuard)
  @Get('users')
  getMembers(@CurrentTenant() tenant: TenantContext) {
    return this.labUsersService.getLabMembers(tenant.tenantId);
  }

  // POST /api/lab/users
  @UseGuards(JwtAuthGuard, LabTenantGuard)
  @Roles(TenantRole.ADMIN, TenantRole.OWNER)
  @Post('users')
  createUser(
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: CreateLabUserDto
  ) {
    return this.labUsersService.createLabUser(tenant.tenantId, dto);
  }

  // PATCH /api/lab/users/:userId/role
  @UseGuards(JwtAuthGuard, LabTenantGuard)
  @Roles(TenantRole.ADMIN, TenantRole.OWNER)
  @Patch('users/:userId/role')
  updateRole(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId') userId: string,
    @Body() dto: UpdateLabUserRoleDto
  ) {
    return this.labUsersService.updateRole(
      tenant.tenantId,
      userId,
      dto.role,
      user.id
    );
  }

  // PATCH /api/lab/users/:userId
  @UseGuards(JwtAuthGuard, LabTenantGuard)
  @Roles(TenantRole.ADMIN, TenantRole.OWNER)
  @Patch('users/:userId')
  updateUser(
    @CurrentTenant() tenant: TenantContext,
    @Param('userId') userId: string,
    @Body() dto: UpdateLabUserDto
  ) {
    return this.labUsersService.updateUser(tenant.tenantId, userId, dto);
  }

  // DELETE /api/lab/users/:userId
  @UseGuards(JwtAuthGuard, LabTenantGuard)
  @Roles(TenantRole.ADMIN, TenantRole.OWNER)
  @Delete('users/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeMember(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId') userId: string
  ) {
    return this.labUsersService.removeMember(tenant.tenantId, userId, user.id);
  }

  // ---------------------------------------------------------------------------
  // Client management — ADMIN only
  // ---------------------------------------------------------------------------

  // GET /api/lab/clients?status=ACTIVE&search=acme&page=1&pageSize=20
  @UseGuards(JwtAuthGuard, LabTenantGuard)
  @Roles(TenantRole.ADMIN, TenantRole.OWNER)
  @Get('clients')
  listClients(
    @CurrentTenant() tenant: TenantContext,
    @Query() query: ListClientsDto
  ) {
    return this.labClientsService.listClients(tenant.tenantId, query);
  }

  // GET /api/lab/clients/:id
  @UseGuards(JwtAuthGuard, LabTenantGuard)
  @Roles(TenantRole.ADMIN, TenantRole.OWNER)
  @Get('clients/:id')
  getClientDetail(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string
  ) {
    return this.labClientsService.getClientDetail(tenant.tenantId, id);
  }

  // POST /api/lab/clients
  @UseGuards(JwtAuthGuard, LabTenantGuard)
  @Roles(TenantRole.ADMIN, TenantRole.OWNER)
  @Post('clients')
  @HttpCode(HttpStatus.CREATED)
  createClient(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateClientDto
  ) {
    return this.labClientsService.createClient(tenant.tenantId, dto, user.id);
  }

  // PATCH /api/lab/clients/:id
  @UseGuards(JwtAuthGuard, LabTenantGuard)
  @Roles(TenantRole.ADMIN, TenantRole.OWNER)
  @Patch('clients/:id')
  updateClient(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body() dto: UpdateClientDto
  ) {
    return this.labClientsService.updateClient(tenant.tenantId, id, dto);
  }

  // POST /api/lab/clients/:id/suspend
  @UseGuards(JwtAuthGuard, LabTenantGuard)
  @Roles(TenantRole.ADMIN, TenantRole.OWNER)
  @Post('clients/:id/suspend')
  @HttpCode(HttpStatus.OK)
  suspendClient(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string
  ) {
    return this.labClientsService.suspendClient(tenant.tenantId, id);
  }

  // POST /api/lab/clients/:id/reactivate
  @UseGuards(JwtAuthGuard, LabTenantGuard)
  @Roles(TenantRole.ADMIN, TenantRole.OWNER)
  @Post('clients/:id/reactivate')
  @HttpCode(HttpStatus.OK)
  reactivateClient(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string
  ) {
    return this.labClientsService.reactivateClient(tenant.tenantId, id);
  }

  // POST /api/lab/clients/:id/invitation/regenerate
  @UseGuards(JwtAuthGuard, LabTenantGuard)
  @Roles(TenantRole.ADMIN, TenantRole.OWNER)
  @Post('clients/:id/invitation/regenerate')
  regenerateInvitation(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string
  ) {
    return this.labClientsService.regenerateInvitation(
      tenant.tenantId,
      id,
      user.id
    );
  }

  // POST /api/lab/clients/:id/invitation/revoke
  @UseGuards(JwtAuthGuard, LabTenantGuard)
  @Roles(TenantRole.ADMIN, TenantRole.OWNER)
  @Post('clients/:id/invitation/revoke')
  revokeInvitation(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string
  ) {
    return this.labClientsService.revokeInvitation(tenant.tenantId, id);
  }

  // DELETE /api/lab/clients/:id
  @UseGuards(JwtAuthGuard, LabTenantGuard)
  @Roles(TenantRole.ADMIN, TenantRole.OWNER)
  @Delete('clients/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteClient(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string
  ) {
    return this.labClientsService.deleteClient(tenant.tenantId, id);
  }

  // PATCH /api/lab/clients/:id/collection-settings
  @UseGuards(JwtAuthGuard, LabTenantGuard)
  @Roles(TenantRole.ADMIN, TenantRole.OWNER)
  @Patch('clients/:id/collection-settings')
  updateCollectionSettings(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body() dto: UpdateCollectionSettingsDto
  ) {
    return this.labClientsService.updateCollectionSettings(
      tenant.tenantId,
      id,
      dto
    );
  }
}
