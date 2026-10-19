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
  /** Accepted tubes (from the preview) staff confirm have enough usable
   * sample left — every tube the added tests run on must be listed */
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsString({ each: true })
  confirmedSpecimenIds!: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
