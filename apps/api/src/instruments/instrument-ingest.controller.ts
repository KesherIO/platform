import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { ConnectorAuthGuard, type ConnectorRequest } from './connector-auth.guard';
import { InstrumentIngestService } from './instrument-ingest.service';
import { readRawBody } from './raw-body.util';

/** A VH-30 frame is ~0.7 MB; this is the cap on the DECOMPRESSED upload. */
const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;
const SHA256_HEX = /^[0-9a-fA-F]{64}$/;

/**
 * Machine-to-machine endpoints for the local connector. Not behind the Supabase
 * JWT guard (@Public); ConnectorAuthGuard authenticates the per-analyzer token
 * and the lab is taken from THAT credential, never from the request.
 */
@ApiExcludeController()
@ApiBearerAuth()
@Public()
@UseGuards(ConnectorAuthGuard)
@Controller('instrument-ingest')
export class InstrumentIngestController {
  constructor(private readonly ingest: InstrumentIngestService) {}

  /** Lets the connector verify its credential and show what it is bound to. */
  @Get('ping')
  ping(@Req() req: ConnectorRequest) {
    const c = req.connector;
    return { ok: true, analyzer: c.analyzerName, credential: c.credentialName, serverTime: new Date().toISOString() };
  }

  /**
   * Body: the exact bytes received from the analyzer (application/octet-stream,
   * optionally Content-Encoding: gzip). Idempotent: the same bytes uploaded
   * again return the original record with duplicateUpload=true.
   */
  @Post('messages')
  @HttpCode(HttpStatus.OK)
  async upload(
    @Req() req: ConnectorRequest,
    @Headers('x-content-sha256') sha256: string | undefined,
    @Headers('x-received-at') receivedAt: string | undefined,
    @Headers('x-transfer-status') transferStatus: string | undefined,
    @Headers('x-incomplete-reason') incompleteReason: string | undefined,
    @Headers('x-local-id') localId: string | undefined,
    @Headers('x-remote-address') remoteAddress: string | undefined
  ) {
    if (!sha256 || !SHA256_HEX.test(sha256)) throw new BadRequestException('X-Content-SHA256 (64 hex chars) is required.');
    const received = receivedAt ? new Date(receivedAt) : null;
    if (!received || Number.isNaN(received.getTime())) throw new BadRequestException('X-Received-At must be an ISO date.');
    if (transferStatus !== 'complete' && transferStatus !== 'incomplete') {
      throw new BadRequestException('X-Transfer-Status must be "complete" or "incomplete".');
    }
    const bytes = await readRawBody(req, MAX_UPLOAD_BYTES);
    return this.ingest.ingest({
      connector: req.connector,
      bytes,
      claimedSha256: sha256,
      receivedAt: received,
      complete: transferStatus === 'complete',
      incompleteReason: incompleteReason?.slice(0, 100),
      localId: localId?.slice(0, 200),
      remoteAddress: remoteAddress?.slice(0, 64),
    });
  }
}
