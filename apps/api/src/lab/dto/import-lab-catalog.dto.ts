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
    description:
      'When true, all existing catalog items for the lab are deleted before inserting ' +
      'the new ones. WARNING: also removes any CaseCatalogItem selections that reference deleted items.',
  })
  @IsOptional()
  @IsBoolean()
  replace?: boolean;
}
