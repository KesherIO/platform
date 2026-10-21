import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { OrderPriority, DeliveryMethod } from '@vet-ai/shared-types';

export class AlternateLocationDto {
  @ApiProperty({ example: 'Finca La Esperanza, vereda El Rosal' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  address!: string;

  @ApiProperty({ example: 'Juan Pérez' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  contactName!: string;

  @ApiProperty({ example: '+57 300 111 2222' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  contactPhone!: string;

  @ApiPropertyOptional({ example: 'Portón verde, apartamento 301' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

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
    type: AlternateLocationDto,
    description:
      'One-off collection location for this order. Only valid with LAB_PICKUP; overrides the clinic’s usual collection point.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => AlternateLocationDto)
  alternateLocation?: AlternateLocationDto;

  @ApiPropertyOptional({
    example: 'Patient fasted for 8 hours. Please rush lipase.',
  })
  @IsOptional()
  @IsString()
  clinicNotes?: string;
}
