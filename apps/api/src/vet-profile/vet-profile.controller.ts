import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiConsumes,
  ApiOperation,
  ApiTags,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '@vet-ai/shared-types';
import { VetProfileService } from './vet-profile.service';
import {
  CreateCredentialBodyDto,
  CreateVetProfileDto,
  UpdateVetProfileDto,
} from './vet-profile.dto';

@ApiTags('vet-profile')
@ApiBearerAuth()
@Controller('vet-profile')
export class VetProfileController {
  constructor(private readonly vetProfileService: VetProfileService) {}

  @Get()
  @ApiOperation({
    summary: 'Get own veterinarian profile and active credential',
  })
  getProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.vetProfileService.getProfile(user.id);
  }

  @Post()
  @ApiOperation({
    summary: 'Create veterinarian profile for the authenticated user',
  })
  createProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateVetProfileDto
  ) {
    return this.vetProfileService.createProfile(user.id, dto);
  }

  @Patch()
  @ApiOperation({ summary: 'Update veterinarian profile legalName' })
  updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateVetProfileDto
  ) {
    return this.vetProfileService.updateProfile(user.id, dto);
  }

  @Post('credential')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a new credential document' })
  createCredential(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: CreateCredentialBodyDto
  ) {
    if (!file) {
      throw new BadRequestException('Credential document file is required.');
    }
    return this.vetProfileService.createCredential(user.id, file, dto);
  }

  @Get('credential/document')
  @ApiOperation({
    summary: 'Get a signed URL for own active credential document',
  })
  getCredentialDocument(@CurrentUser() user: AuthenticatedUser) {
    return this.vetProfileService.getCredentialDocumentUrl(user.id);
  }
}
