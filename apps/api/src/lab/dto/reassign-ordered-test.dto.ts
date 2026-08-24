import { IsInt, IsString, IsNotEmpty, Min } from 'class-validator';

export class ReassignOrderedTestDto {
  @IsString()
  @IsNotEmpty()
  targetUserId!: string;

  @IsInt()
  @Min(1)
  version!: number;
}
