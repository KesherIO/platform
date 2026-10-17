import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser, TenantContext } from '@vet-ai/shared-types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { LabTenantGuard } from './lab-tenant.guard';
import { LAB_ALL_ROLES } from './lab-roles';
import { NotificationService } from '../notifications/notification.service';
import { ListNotificationsQueryDto } from '../notifications/dto/notifications.dto';

/**
 * Lab notification inbox — the caller's own notifications in their lab, so
 * every lab role may use it. Push subscriptions stay on the messenger routes
 * (LabController) — the only lab pushes so far are pickup alerts.
 */
@ApiTags('lab')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, LabTenantGuard)
@Roles(...LAB_ALL_ROLES)
@Controller('lab/notifications')
export class LabNotificationsController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  @ApiOperation({ summary: 'My notifications in this lab' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTenant() tenant: TenantContext,
    @Query() query: ListNotificationsQueryDto
  ) {
    return this.notifications.list(user.id, tenant.tenantId, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'My unread notifications in this lab' })
  unreadCount(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTenant() tenant: TenantContext
  ) {
    return this.notifications.unreadCount(user.id, tenant.tenantId, 'LAB');
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark all my lab notifications read' })
  markAllRead(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTenant() tenant: TenantContext
  ) {
    return this.notifications.markAllRead(user.id, tenant.tenantId);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark one of my lab notifications read' })
  markRead(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string
  ) {
    return this.notifications.markRead(user.id, tenant.tenantId, id);
  }

  @Post('dismiss-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Clear all my lab notifications' })
  dismissAll(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTenant() tenant: TenantContext
  ) {
    return this.notifications.dismissAll(user.id, tenant.tenantId);
  }

  @Post(':id/dismiss')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Clear one of my lab notifications' })
  dismiss(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string
  ) {
    return this.notifications.dismiss(user.id, tenant.tenantId, id);
  }
}
