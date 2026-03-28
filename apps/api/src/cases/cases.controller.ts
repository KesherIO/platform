import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CasesService } from './cases.service';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { AuthenticatedUser, TenantContext } from '@vet-ai/shared-types';

@ApiTags('cases')
@ApiBearerAuth()
@UseGuards(TenantGuard)
@Controller('cases')
export class CasesController {
  constructor(private readonly casesService: CasesService) {}

  @Get()
  @ApiOperation({ summary: 'List all cases for the active tenant' })
  findAll(
    @CurrentUser() _user: AuthenticatedUser,
    @CurrentTenant() _tenant: TenantContext,
  ) {
    return this.casesService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single case by ID' })
  findOne(@Param('id') id: string) {
    return this.casesService.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new case' })
  create(@Body() _body: unknown) {
    return this.casesService.create();
  }
}