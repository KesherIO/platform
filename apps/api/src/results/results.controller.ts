import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Res,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiHeader,
} from '@nestjs/swagger';
import { ResultsService } from './results.service';
import { InternalApiKeyGuard } from '../auth/guards/internal-api-key.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext, AuthenticatedUser } from '@vet-ai/shared-types';
import {
  ImportTemplateDto,
  CreateReportDto,
  SaveAnalytesDto,
  ReleaseReportDto,
} from './dto/results.dto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

@ApiTags('results')
@Controller('results')
export class ResultsController {
  constructor(
    private readonly resultsService: ResultsService,
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService
  ) {}

  // ---------------------------------------------------------------------------
  // GET /results/templates
  // List all active templates — readable by any authenticated user.
  // ---------------------------------------------------------------------------

  @Get('templates')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all active result templates' })
  findTemplates() {
    return this.resultsService.findTemplates();
  }

  // ---------------------------------------------------------------------------
  // GET /results/templates/:id
  // Get a single template by ID — for the lab UI template editor.
  // ---------------------------------------------------------------------------

  @Get('templates/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a single result template by ID' })
  findTemplate(@Param('id') id: string) {
    return this.resultsService.findTemplate(id);
  }

  // ---------------------------------------------------------------------------
  // POST /results/templates
  // Import (upsert) a result template — KesherIO lab internal only.
  // ---------------------------------------------------------------------------

  @Post('templates')
  @Public()
  @UseGuards(InternalApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('x-internal-api-key')
  @ApiHeader({
    name: 'x-internal-api-key',
    description: 'KesherIO internal API key',
    required: true,
  })
  @ApiOperation({
    summary: 'Import (upsert) a result template — KesherIO lab internal only',
  })
  importTemplate(@Body() body: ImportTemplateDto) {
    return this.resultsService.importTemplate(body);
  }

  // ---------------------------------------------------------------------------
  // POST /results/reports
  // Create a result report for an order from the matching template.
  // Lab internal — not tenant-scoped.
  // ---------------------------------------------------------------------------

  @Post('reports')
  @Public()
  @UseGuards(InternalApiKeyGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiSecurity('x-internal-api-key')
  @ApiHeader({
    name: 'x-internal-api-key',
    description: 'KesherIO internal API key',
    required: true,
  })
  @ApiOperation({
    summary:
      'Create a structured result report for an order — lab internal only',
  })
  createReport(@Body() body: CreateReportDto) {
    return this.resultsService.createReport(body);
  }

  // ---------------------------------------------------------------------------
  // GET /results/reports/:id
  // Get a specific report by ID — lab internal.
  // ---------------------------------------------------------------------------

  @Get('reports/:id')
  @Public()
  @UseGuards(InternalApiKeyGuard)
  @ApiSecurity('x-internal-api-key')
  @ApiHeader({
    name: 'x-internal-api-key',
    description: 'KesherIO internal API key',
    required: true,
  })
  @ApiOperation({ summary: 'Get a result report by ID — lab internal only' })
  findReport(@Param('id') id: string) {
    return this.resultsService.findReport(id);
  }

  // ---------------------------------------------------------------------------
  // PATCH /results/reports/:id/analytes
  // Batch-save analyte values on a DRAFT report — lab internal.
  // ---------------------------------------------------------------------------

  @Patch('reports/:id/analytes')
  @Public()
  @UseGuards(InternalApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('x-internal-api-key')
  @ApiHeader({
    name: 'x-internal-api-key',
    description: 'KesherIO internal API key',
    required: true,
  })
  @ApiOperation({
    summary: 'Save analyte values on a DRAFT report — lab internal only',
  })
  saveAnalytes(@Param('id') id: string, @Body() body: SaveAnalytesDto) {
    return this.resultsService.saveAnalytes(id, body);
  }

  // ---------------------------------------------------------------------------
  // POST /results/reports/:id/release
  // Release a DRAFT report — lab internal.
  // Computes flags, freezes values, advances case to COMPLETED.
  // ---------------------------------------------------------------------------

  @Post('reports/:id/release')
  @Public()
  @UseGuards(InternalApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('x-internal-api-key')
  @ApiHeader({
    name: 'x-internal-api-key',
    description: 'KesherIO internal API key',
    required: true,
  })
  @ApiOperation({ summary: 'Release a result report — lab internal only' })
  releaseReport(@Param('id') id: string, @Body() body: ReleaseReportDto) {
    return this.resultsService.releaseReport(id, body);
  }

  // ---------------------------------------------------------------------------
  // GET /results/by-order/:orderId
  // Clinic reads the released result for one of their orders — tenant-scoped.
  // ---------------------------------------------------------------------------

  @Get('by-order/:orderId')
  @ApiBearerAuth()
  @ApiSecurity('x-tenant-id')
  @UseGuards(TenantGuard)
  @ApiOperation({ summary: 'Get the result report for an order (clinic view)' })
  findReportByOrderId(
    @CurrentTenant() tenant: TenantContext,
    @Param('orderId') orderId: string
  ) {
    return this.resultsService.findReportByOrderId(tenant.tenantId, orderId);
  }

  // ---------------------------------------------------------------------------
  // GET /results/by-order/:orderId/released
  // Clinic reads only RELEASED results from immutable snapshots.
  // Supports both partial and final releases.
  // ---------------------------------------------------------------------------

  @Get('by-order/:orderId/released')
  @ApiBearerAuth()
  @ApiSecurity('x-tenant-id')
  @UseGuards(TenantGuard)
  @ApiOperation({
    summary: 'Get released results for an order (clinic view, snapshot data)',
  })
  findReleasedResultsByOrder(
    @CurrentTenant() tenant: TenantContext,
    @Param('orderId') orderId: string
  ) {
    return this.resultsService.findReleasedResultsByOrder(
      tenant.tenantId,
      orderId
    );
  }

  // ---------------------------------------------------------------------------
  // GET /results/reports/:id/interpret
  // Return the stored AI interpretation if it exists — no Claude call.
  // Returns null when none has been generated yet.
  // ---------------------------------------------------------------------------

  @Get('reports/:id/interpret')
  @ApiBearerAuth()
  @ApiSecurity('x-tenant-id')
  @UseGuards(TenantGuard)
  @ApiOperation({
    summary: 'Get stored AI interpretation for a report, if any',
  })
  findInterpretation(
    @Param('id') id: string,
    @CurrentTenant() tenant: TenantContext,
    @Query('lang') lang?: string
  ) {
    const safeLang = lang === 'es' ? 'es' : 'en';
    return this.resultsService.findInterpretation(
      id,
      tenant.tenantId,
      safeLang
    );
  }

  // ---------------------------------------------------------------------------
  // POST /results/reports/:id/interpret
  // Get or create AI interpretation for a released report — clinic-facing.
  // Returns cached interpretation if already generated, otherwise calls AI.
  // ---------------------------------------------------------------------------

  @Post('reports/:id/interpret')
  @ApiBearerAuth()
  @ApiSecurity('x-tenant-id')
  @UseGuards(TenantGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Get or create AI interpretation for a released report (clinic view)',
  })
  interpretReport(
    @Param('id') id: string,
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body('lang') lang?: string
  ) {
    const safeLang = lang === 'es' ? 'es' : 'en';
    return this.resultsService.getOrCreateInterpretation(
      id,
      tenant.tenantId,
      user?.id,
      safeLang
    );
  }

  // ---------------------------------------------------------------------------
  // GET /results/by-order/:orderId/releases
  // Clinic reads the release history with PDF status for an order.
  // ---------------------------------------------------------------------------

  @Get('by-order/:orderId/releases')
  @ApiBearerAuth()
  @ApiSecurity('x-tenant-id')
  @UseGuards(TenantGuard)
  @ApiOperation({
    summary: 'Get release history with PDF status (clinic view)',
  })
  async getOrderReleases(
    @CurrentTenant() tenant: TenantContext,
    @Param('orderId') orderId: string
  ) {
    // Clinic-facing :orderId is the requisition number (same as /released).
    const order = await this.prisma.order.findFirst({
      where: { requisitionNumber: orderId, tenantId: tenant.tenantId },
      select: {
        id: true,
        requisitionNumber: true,
        resultReport: { select: { id: true } },
      },
    });
    if (!order) throw new NotFoundException('Order not found.');
    if (!order.resultReport) {
      return { requisitionNumber: order.requisitionNumber, releases: [] };
    }

    const releases = await this.prisma.resultReportRelease.findMany({
      where: { reportId: order.resultReport.id },
      include: {
        tests: { select: { catalogItemName: true } },
        artifacts: {
          where: { artifactType: 'PDF' },
          select: { status: true },
          take: 1,
        },
      },
      orderBy: { releaseSequence: 'asc' },
    });

    return {
      requisitionNumber: order.requisitionNumber,
      releases: releases.map((r) => ({
        id: r.id,
        releaseSequence: r.releaseSequence,
        releaseType: r.releaseType,
        signerName: r.signerName,
        releasedAt: r.releasedAt.toISOString(),
        pdfStatus: r.artifacts[0]?.status ?? 'PENDING',
        testNames: r.tests.map((t) => t.catalogItemName),
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // GET /results/by-order/:orderId/pdf?releaseSequence=N
  // Clinic downloads a specific release PDF.
  // ---------------------------------------------------------------------------

  @Get('by-order/:orderId/pdf')
  @ApiBearerAuth()
  @ApiSecurity('x-tenant-id')
  @UseGuards(TenantGuard)
  @ApiOperation({ summary: 'Download a release PDF (clinic view)' })
  async downloadReleasePdf(
    @CurrentTenant() tenant: TenantContext,
    @Param('orderId') orderId: string,
    @Query('releaseSequence') releaseSequenceRaw: string,
    @Res() res: Response
  ) {
    const releaseSequence = parseInt(releaseSequenceRaw, 10);
    if (isNaN(releaseSequence) || releaseSequence < 1) {
      throw new BadRequestException('Invalid releaseSequence.');
    }

    // Clinic-facing :orderId is the requisition number (same as /released).
    const order = await this.prisma.order.findFirst({
      where: { requisitionNumber: orderId, tenantId: tenant.tenantId },
      select: { id: true, resultReport: { select: { id: true } } },
    });
    if (!order || !order.resultReport) {
      throw new NotFoundException('Order or report not found.');
    }

    const release = await this.prisma.resultReportRelease.findUnique({
      where: {
        reportId_releaseSequence: {
          reportId: order.resultReport.id,
          releaseSequence,
        },
      },
      select: { id: true },
    });
    if (!release) throw new NotFoundException('Release not found.');

    const artifact = await this.prisma.resultReportReleaseArtifact.findFirst({
      where: { releaseId: release.id, artifactType: 'PDF' },
      select: { status: true, storageUrl: true },
    });
    if (!artifact || artifact.status !== 'COMPLETED' || !artifact.storageUrl) {
      throw new NotFoundException('PDF not ready yet.');
    }

    const buffer = await this.storageService.downloadObject(
      'lab-reports',
      artifact.storageUrl
    );
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="release-${releaseSequence}.pdf"`,
      'Content-Length': buffer.length.toString(),
    });
    res.end(buffer);
  }
}
