import { Module } from '@nestjs/common';
import { CasesController } from './cases.controller';
import { CasesService } from './cases.service';
import { OrdersModule } from '../orders/orders.module';
import { TriageModule } from '../triage/triage.module';

@Module({
  imports: [OrdersModule, TriageModule],
  controllers: [CasesController],
  providers: [CasesService],
})
export class CasesModule {}
