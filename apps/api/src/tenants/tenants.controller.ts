import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { TenantsService } from './tenants.service';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { TenantRole } from '@vet-ai/shared-types';

@ApiTags('tenants')
@ApiBearerAuth()
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Get(':id')
  @UseGuards(TenantGuard)
  @Roles(TenantRole.OWNER, TenantRole.ADMIN)
  @ApiOperation({ summary: 'Get tenant details (owner/admin only)' })
  findOne(@Param('id') id: string) {
    return this.tenantsService.findOne(id);
  }
}