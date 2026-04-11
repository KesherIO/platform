import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import type { TenantContext } from '@vet-ai/shared-types';

@ApiTags('orders')
@ApiBearerAuth()
@UseGuards(TenantGuard)
@Controller('orders')
export class OrdersController {
  // ---------------------------------------------------------------------------
  // GET /orders/:id/requisition
  // Returns a minimal requisition document (PDF generation is a future feature).
  // ---------------------------------------------------------------------------

  @Get(':id/requisition')
  @ApiOperation({ summary: 'Get requisition document for an order' })
  getRequisition(
    @CurrentTenant() _tenant: TenantContext,
    @Param('id') _id: string
  ) {
    // TODO: generate and stream a PDF requisition document
    return { message: 'Requisition PDF generation coming soon.' };
  }
}
