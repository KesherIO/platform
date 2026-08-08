import { IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class PushSubscriptionKeysDto {
  @IsString()
  p256dh!: string;

  @IsString()
  auth!: string;
}

export class SavePushSubscriptionDto {
  @IsString()
  endpoint!: string;

  @ValidateNested()
  @Type(() => PushSubscriptionKeysDto)
  keys!: PushSubscriptionKeysDto;
}
