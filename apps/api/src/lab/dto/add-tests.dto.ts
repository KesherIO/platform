import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/** POST lab/orders/:orderId/add-tests/preview — what adding these would do. */
export class AddTestsPreviewDto {
  /** Catalog tests and/or packages of this lab's catalog */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsString({ each: true })
  catalogItemIds!: string[];
}

/** POST lab/orders/:orderId/add-tests — add them to the open order. */
export class AddTestsDto extends AddTestsPreviewDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
