import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import type { OrderPriority, DeliveryMethod } from '@vet-ai/shared-types';

export class CreateOrderDto {
  @ApiPropertyOptional({
    example: 'user-cuid',
    description:
      'User ID of the ordering vet. Falls back to Case.attendingVetId when omitted.',
  })
  @IsOptional()
  @IsString()
  orderingVetId?: string;

  @ApiPropertyOptional({
    enum: ['ROUTINE', 'URGENT', 'STAT'],
    default: 'ROUTINE',
  })
  @IsOptional()
  @IsEnum(['ROUTINE', 'URGENT', 'STAT'] as const)
  priority?: OrderPriority;

  @ApiPropertyOptional({
    enum: ['LAB_PICKUP', 'CLIENT_DELIVERY'],
    default: 'CLIENT_DELIVERY',
  })
  @IsOptional()
  @IsEnum(['LAB_PICKUP', 'CLIENT_DELIVERY'] as const)
  deliveryMethod?: DeliveryMethod;

  @ApiPropertyOptional({
    example: 'Patient fasted for 8 hours. Please rush lipase.',
  })
  @IsOptional()
  @IsString()
  clinicNotes?: string;
}
