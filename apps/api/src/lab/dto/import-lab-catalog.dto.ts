import {
  IsArray,
  IsBoolean,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ImportCatalogItemDto } from '../../catalog/dto/catalog.dto';

export class ImportLabCatalogDto {
  @ApiProperty({ type: [ImportCatalogItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportCatalogItemDto)
  items!: ImportCatalogItemDto[];

  @ApiPropertyOptional({
    default: false,
    deprecated: true,
    description:
      'UNSUPPORTED — true is rejected with a 400 before anything is deleted. ' +
      'Import without it: existing items are updated and new ones added.',
  })
  @IsOptional()
  @IsBoolean()
  replace?: boolean;
}
