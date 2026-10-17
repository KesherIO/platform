import { Module } from '@nestjs/common';
import { PushService } from './push.service';
import { NotificationService } from './notification.service';
import { NotificationDeliveryWorker } from './notification-delivery.worker';
import { NotificationsController } from './notifications.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [NotificationsController],
  providers: [PushService, NotificationService, NotificationDeliveryWorker],
  exports: [PushService, NotificationService, NotificationDeliveryWorker],
})
export class NotificationsModule {}
