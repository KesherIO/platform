import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpdateCollectionSettingsDto {
  @IsBoolean()
  @IsOptional()
  pickupEnabled?: boolean;

  @IsEnum(['LAB_PICKUP', 'CLIENT_DELIVERY'])
  @IsOptional()
  defaultDeliveryMethod?: string;

  @IsString()
  @MaxLength(300)
  @IsOptional()
  pickupAddress?: string;

  @IsString()
  @MaxLength(150)
  @IsOptional()
  pickupContactName?: string;

  @IsString()
  @MaxLength(50)
  @IsOptional()
  pickupContactPhone?: string;

  @IsString()
  @MaxLength(200)
  @IsOptional()
  collectionHours?: string;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  pickupInstructions?: string;
}
