import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  Equals,
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
  /** Accepted samples of the order (from the preview) the tests run on */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsString({ each: true })
  specimenIds!: string[];

  /** Staff confirm the selected samples are suitable and sufficient for
   * every added test */
  @Equals(true)
  confirmedSuitable!: true;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
