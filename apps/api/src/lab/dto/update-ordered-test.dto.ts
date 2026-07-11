import { IsEnum, IsOptional, IsString } from 'class-validator';
import type { OrderedTestStatus, ResultEntryMethod } from '@vet-ai/shared-types';

export class UpdateOrderedTestDto {
  @IsEnum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'])
  @IsOptional()
  status?: OrderedTestStatus;

  @IsEnum(['MANUAL', 'INSTRUMENT', 'IMPORTED'])
  @IsOptional()
  entryMethod?: ResultEntryMethod;

  @IsString()
  @IsOptional()
  assignedUserId?: string | null;

  @IsString()
  @IsOptional()
  instrumentId?: string | null;
}
