import { Module } from '@nestjs/common';
import { TriageService } from './triage.service';
import { CatalogModule } from '../catalog/catalog.module';

@Module({
  imports: [CatalogModule],
  providers: [TriageService],
  exports: [TriageService],
})
export class TriageModule {}
