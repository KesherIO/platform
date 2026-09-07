import { Controller, Get, Post, UseGuards, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiSecurity } from '@nestjs/swagger';
import * as Sentry from '@sentry/nestjs';
import { Public } from '../auth/decorators/public.decorator';
import { InternalApiKeyGuard } from '../auth/guards/internal-api-key.guard';
import { PrismaHealthIndicator } from './prisma-health.indicator';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly db: PrismaHealthIndicator) {}

  @Get('live')
  @Public()
  @ApiOperation({ summary: 'Liveness — process is running' })
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  @Public()
  @ApiOperation({ summary: 'Readiness — database is reachable' })
  async ready() {
    const result = await this.db.isHealthy();
    if (result.database.status !== 'up') {
      throw new ServiceUnavailableException({ status: 'error', details: result });
    }
    return { status: 'ok', details: result };
  }

  @Post('test-error')
  @Public()
  @UseGuards(InternalApiKeyGuard)
  @ApiSecurity('x-internal-api-key')
  @ApiOperation({
    summary:
      'Trigger a controlled test error for Sentry alert verification (remove before final handoff)',
  })
  testError() {
    const error = new Error('Sentry test error — API');
    Sentry.captureException(error);
    return { captured: true, message: error.message };
  }
}
