import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { PdfRendererService } from './pdf-renderer.service';
import { PdfProcessorService } from './pdf-processor.service';

@Module({
  imports: [PrismaModule, StorageModule],
  providers: [PdfRendererService, PdfProcessorService],
  exports: [PdfRendererService, PdfProcessorService],
})
export class PdfModule {}
