import { IsEnum } from 'class-validator';

export class UpdateOrderStatusDto {
  @IsEnum([
    'PENDING',
    'READY_FOR_PICKUP',
    'COLLECTED',
    'RECEIVED_BY_LAB',
    'PROCESSING',
    'COMPLETED',
    'CANCELLED',
  ])
  status!: string;
}
