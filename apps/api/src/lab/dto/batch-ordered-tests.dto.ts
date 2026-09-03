import {
  IsArray,
  IsInt,
  IsString,
  Min,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

class BatchClaimItem {
  @IsString()
  testId!: string;

  @IsInt()
  @Min(1)
  version!: number;
}

export class BatchClaimDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BatchClaimItem)
  tests!: BatchClaimItem[];
}

export class BatchStartDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  testIds!: string[];
}

export class BatchResultSessionsDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  testIds!: string[];
}
