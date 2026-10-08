import {
  Controller,
  Get,
  Delete,
  Patch,
  Param,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiConsumes,
  ApiSecurity,
} from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { TenantsService } from './tenants.service';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { TenantRole } from '@vet-ai/shared-types';
import type { TenantContext } from '@vet-ai/shared-types';

/**
 * Clinic profile edit from clinic settings. Omitted fields are preserved;
 * '' or null clears an optional field (see clinic-profile.util.ts). The clinic
 * contact email is locked in this screen and is not accepted here.
 */
class UpdateClinicDto {
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  primaryContactName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string | null;

  /** ISO 3166-1 alpha-2, e.g. "CO" */
  @IsOptional()
  @IsString()
  @Matches(/^([A-Z]{2})?$/)
  country?: string | null;
}

class UpdateStaffRoleDto {
  @IsEnum(['admin', 'vet', 'technician', 'receptionist'])
  role!: 'admin' | 'vet' | 'technician' | 'receptionist';
}

@ApiTags('tenants')
@ApiBearerAuth()
@ApiSecurity('x-tenant-id')
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Get(':id')
  @UseGuards(TenantGuard)
  @Roles(TenantRole.OWNER, TenantRole.ADMIN)
  @ApiOperation({ summary: 'Get tenant details (owner/admin only)' })
  findOne(@Param('id') _id: string) {
    return this.tenantsService.findOne(_id);
  }

  @Patch(':id')
  @UseGuards(TenantGuard)
  @Roles(TenantRole.OWNER, TenantRole.ADMIN)
  @UseInterceptors(FileInterceptor('logo'))
  @ApiOperation({ summary: 'Update clinic info and/or logo (admin only)' })
  @ApiConsumes('multipart/form-data', 'application/json')
  updateClinic(
    @CurrentTenant() tenant: TenantContext,
    @Body() body: UpdateClinicDto,
    @UploadedFile() logo?: Express.Multer.File
  ) {
    return this.tenantsService.updateClinic(tenant.tenantId, body, logo);
  }

  @Get(':id/staff')
  @UseGuards(TenantGuard)
  @Roles(TenantRole.OWNER, TenantRole.ADMIN)
  @ApiOperation({
    summary: 'List staff members and pending invites (admin only)',
  })
  getStaff(@CurrentTenant() tenant: TenantContext) {
    return this.tenantsService.getStaff(tenant.tenantId);
  }

  @Delete(':id/staff/:userId')
  @UseGuards(TenantGuard)
  @Roles(TenantRole.OWNER, TenantRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove a staff member from the clinic (admin only)',
  })
  removeStaff(
    @CurrentTenant() tenant: TenantContext,
    @Param('userId') userId: string
  ) {
    return this.tenantsService.removeStaff(tenant.tenantId, userId);
  }

  @Patch(':id/staff/:userId/role')
  @UseGuards(TenantGuard)
  @Roles(TenantRole.OWNER, TenantRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Update a staff member's role (admin only)" })
  updateStaffRole(
    @CurrentTenant() tenant: TenantContext,
    @Param('userId') userId: string,
    @Body() body: UpdateStaffRoleDto
  ) {
    const roleMap: Record<string, TenantRole> = {
      admin: TenantRole.ADMIN,
      vet: TenantRole.VET,
      technician: TenantRole.TECHNICIAN,
      receptionist: TenantRole.RECEPTIONIST,
    };
    const role = roleMap[body.role] ?? TenantRole.VET;
    return this.tenantsService.updateStaffRole(tenant.tenantId, userId, role);
  }

  @Get(':id/vets')
  @UseGuards(TenantGuard)
  @ApiOperation({
    summary: 'List ordering vets in this clinic with verification status',
  })
  getVets(@CurrentTenant() tenant: TenantContext) {
    return this.tenantsService.getVets(tenant.tenantId);
  }

  @Get(':id/lab-contact')
  @UseGuards(TenantGuard)
  @ApiOperation({ summary: "Get the clinic's connected lab contact info" })
  getLabContact(@CurrentTenant() tenant: TenantContext) {
    return this.tenantsService.getLabContact(tenant.tenantId);
  }
}
