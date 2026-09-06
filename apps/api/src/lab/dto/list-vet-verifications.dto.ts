import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ListVetVerificationsDto {
  @IsString()
  @IsOptional()
  @IsIn(['PENDING', 'APPROVED', 'REJECTED', 'REVOKED', 'EXPIRED'])
  status?: string;

  @IsString()
  @IsOptional()
  search?: string;

  @IsInt()
  @Min(1)
  @Type(() => Number)
  @IsOptional()
  page?: number = 1;

  @IsInt()
  @Min(1)
  @Type(() => Number)
  @IsOptional()
  pageSize?: number = 20;
}
