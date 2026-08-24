import { IsString, IsNotEmpty } from 'class-validator';

export class AssignTemplateDto {
  @IsString()
  @IsNotEmpty()
  templateVersionId!: string;
}
