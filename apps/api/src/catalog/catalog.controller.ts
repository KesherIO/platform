import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiHeader,
} from '@nestjs/swagger';
import { CatalogService } from './catalog.service';
import { ImportCatalogDto } from './dto/catalog.dto';
import { InternalApiKeyGuard } from '../auth/guards/internal-api-key.guard';
import { Public } from '../auth/decorators/public.decorator';

@ApiTags('catalog')
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  // ---------------------------------------------------------------------------
  // GET /catalog
  // Global catalog — readable by any authenticated user (no tenant context needed).
  // ---------------------------------------------------------------------------

  @Get()
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'List all active catalog items (global, shared across all clinics)',
  })
  findAll() {
    return this.catalogService.findAll();
  }

  // ---------------------------------------------------------------------------
  // POST /catalog/import
  // Lab-only operation — protected by internal API key, not a clinic role.
  // ---------------------------------------------------------------------------

  @Post('import')
  @Public()
  @UseGuards(InternalApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('x-internal-api-key')
  @ApiHeader({
    name: 'x-internal-api-key',
    description: 'Platform internal API key',
    required: true,
  })
  @ApiOperation({
    summary: 'Import (upsert) catalog items — Platform lab internal only',
  })
  import(@Body() body: ImportCatalogDto) {
    return this.catalogService.import(body);
  }
}
