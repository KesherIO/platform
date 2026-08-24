import { IsInt, Min } from 'class-validator';

export class ClaimOrderedTestDto {
  @IsInt()
  @Min(1)
  version!: number;
}
