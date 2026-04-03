import { Controller, Get, Delete, Patch, Param, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { TenantsService } from './tenants.service';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { TenantRole, TenantContext } from '@vet-ai/shared-types';

class UpdateStaffRoleDto {
  @IsEnum(['admin', 'staff'])
  role!: 'admin' | 'staff';
}

@ApiTags('tenants')
@ApiBearerAuth()
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

  @Get(':id/staff')
  @UseGuards(TenantGuard)
  @Roles(TenantRole.OWNER, TenantRole.ADMIN)
  @ApiOperation({ summary: 'List staff members and pending invites (admin only)' })
  getStaff(@CurrentTenant() tenant: TenantContext) {
    return this.tenantsService.getStaff(tenant.tenantId);
  }

  @Delete(':id/staff/:userId')
  @UseGuards(TenantGuard)
  @Roles(TenantRole.OWNER, TenantRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a staff member from the clinic (admin only)' })
  removeStaff(
    @CurrentTenant() tenant: TenantContext,
    @Param('userId') userId: string,
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
    @Body() body: UpdateStaffRoleDto,
  ) {
    const role = body.role === 'admin' ? TenantRole.ADMIN : TenantRole.VET;
    return this.tenantsService.updateStaffRole(tenant.tenantId, userId, role);
  }
}
