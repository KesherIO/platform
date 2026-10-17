import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedUser, TenantContext } from '@vet-ai/shared-types';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { NotificationService } from './notification.service';
import { PushService } from './push.service';
import {
  ListNotificationsQueryDto,
  PushSubscriptionDto,
  RemovePushSubscriptionDto,
} from './dto/notifications.dto';

/**
 * Clinic notification inbox — always the caller's own notifications in the
 * active clinic (x-tenant-id). The lab inbox is LabNotificationsController.
 */
@ApiTags('notifications')
@ApiBearerAuth()
@ApiSecurity('x-tenant-id')
@UseGuards(TenantGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationService,
    private readonly push: PushService
  ) {}

  @Get()
  @ApiOperation({ summary: 'My notifications in the active clinic' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTenant() tenant: TenantContext,
    @Query() query: ListNotificationsQueryDto
  ) {
    return this.notifications.list(user.id, tenant.tenantId, query);
  }

  @Get('unread-count')
  @ApiOperation({
    summary: 'Unread in the active clinic and in my other clinics',
  })
  unreadCount(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTenant() tenant: TenantContext
  ) {
    return this.notifications.unreadCount(user.id, tenant.tenantId, 'CLINIC');
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark all my notifications in this clinic read' })
  markAllRead(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTenant() tenant: TenantContext
  ) {
    return this.notifications.markAllRead(user.id, tenant.tenantId);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark one of my notifications read' })
  markRead(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string
  ) {
    return this.notifications.markRead(user.id, tenant.tenantId, id);
  }

  @Get('push/public-key')
  @ApiOperation({ summary: 'VAPID public key to subscribe this browser with' })
  pushPublicKey() {
    return { publicKey: this.push.getPublicKey() };
  }

  @Post('push/subscription')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Save this browser’s clinic-app push subscription' })
  savePushSubscription(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PushSubscriptionDto
  ) {
    return this.notifications.savePushSubscription(user.id, 'CLINIC', dto);
  }

  @Delete('push/subscription')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove this browser’s push subscription' })
  removePushSubscription(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RemovePushSubscriptionDto
  ) {
    return this.notifications.removePushSubscription(user.id, dto.endpoint);
  }
}
