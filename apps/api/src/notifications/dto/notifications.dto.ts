import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ListNotificationsQueryDto {
  @ApiPropertyOptional({ description: 'nextCursor of the previous page' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

class PushSubscriptionKeysDto {
  @ApiProperty()
  @IsString()
  @MaxLength(512)
  p256dh!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(512)
  auth!: string;
}

export class PushSubscriptionDto {
  @ApiProperty()
  @IsString()
  @MaxLength(2048)
  endpoint!: string;

  @ApiProperty({ type: PushSubscriptionKeysDto })
  @ValidateNested()
  @Type(() => PushSubscriptionKeysDto)
  keys!: PushSubscriptionKeysDto;
}

export class RemovePushSubscriptionDto {
  @ApiProperty()
  @IsString()
  @MaxLength(2048)
  endpoint!: string;
}
