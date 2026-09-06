import { Module } from '@nestjs/common';
import { VetProfileController } from './vet-profile.controller';
import { VetProfileService } from './vet-profile.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [VetProfileController],
  providers: [VetProfileService],
})
export class VetProfileModule {}
