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
import type { TenantContext, AuthenticatedUser } from '@vet-ai/shared-types';
import { LabService } from './lab.service';
import { LabUsersService } from './lab-users.service';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { UpdateOrderedTestDto } from './dto/update-ordered-test.dto';
import { UpsertLaboratoryProfileDto } from './dto/upsert-laboratory-profile.dto';
import { CreateLabUserDto } from './dto/create-lab-user.dto';
import { UpdateLabUserRoleDto } from './dto/update-lab-user-role.dto';

@Controller('lab')
export class LabController {
  constructor(
    private readonly labService: LabService,
    private readonly labUsersService: LabUsersService
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

  // GET /api/lab/orders?status=RECEIVED_BY_LAB
  @UseGuards(JwtAuthGuard, LabTenantGuard)
  @Get('orders')
  getOrders(
    @CurrentTenant() tenant: TenantContext,
    @Query('status') status?: string
  ) {
    return this.labService.getLabOrders(tenant.tenantId, status);
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
  @Post('orders/:id/ordered-tests')
  initOrderedTests(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string
  ) {
    return this.labService.initOrderedTests(tenant.tenantId, id);
  }

  // PATCH /api/lab/ordered-tests/:testId
  @UseGuards(JwtAuthGuard, LabTenantGuard)
  @Patch('ordered-tests/:testId')
  updateOrderedTest(
    @CurrentTenant() tenant: TenantContext,
    @Param('testId') testId: string,
    @Body() dto: UpdateOrderedTestDto
  ) {
    return this.labService.updateOrderedTest(tenant.tenantId, testId, dto);
  }

  // GET /api/lab/settings/laboratory
  @UseGuards(JwtAuthGuard, LabTenantGuard)
  @Get('settings/laboratory')
  getLaboratoryProfile(@CurrentTenant() tenant: TenantContext) {
    return this.labService.getLaboratoryProfile(tenant.tenantId);
  }

  // PATCH /api/lab/settings/laboratory
  @UseGuards(JwtAuthGuard, LabTenantGuard)
  @Patch('settings/laboratory')
  upsertLaboratoryProfile(
    @CurrentTenant() tenant: TenantContext,
    @Body() body: UpsertLaboratoryProfileDto
  ) {
    return this.labService.upsertLaboratoryProfile(tenant.tenantId, body);
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
  @Post('users')
  createUser(
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: CreateLabUserDto
  ) {
    return this.labUsersService.createLabUser(tenant.tenantId, dto);
  }

  // PATCH /api/lab/users/:userId/role
  @UseGuards(JwtAuthGuard, LabTenantGuard)
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

  // DELETE /api/lab/users/:userId
  @UseGuards(JwtAuthGuard, LabTenantGuard)
  @Delete('users/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeMember(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId') userId: string
  ) {
    return this.labUsersService.removeMember(tenant.tenantId, userId, user.id);
  }
}
