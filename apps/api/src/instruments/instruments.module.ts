import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LabModule } from '../lab/lab.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ConnectorAuthGuard } from './connector-auth.guard';
import { ConnectorCredentialService } from './connector-credential.service';
import { InstrumentIngestController } from './instrument-ingest.controller';
import { InstrumentIngestService } from './instrument-ingest.service';
import { InstrumentProcessorService } from './instrument-processor.service';
import { InstrumentReviewController } from './instrument-review.controller';
import { InstrumentReviewService } from './instrument-review.service';
import { OrderMatchService } from './order-match.service';

/** Analyzer connector backend: authenticated ingest, review queue, draft import. */
@Module({
  imports: [PrismaModule, AuthModule, LabModule],
  controllers: [InstrumentIngestController, InstrumentReviewController],
  providers: [
    ConnectorCredentialService,
    ConnectorAuthGuard,
    InstrumentIngestService,
    InstrumentProcessorService,
    InstrumentReviewService,
    OrderMatchService,
  ],
})
export class InstrumentsModule {}
