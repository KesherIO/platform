import { IsString } from 'class-validator';

export class AssignMessengerDto {
  @IsString()
  messengerId!: string;
}
