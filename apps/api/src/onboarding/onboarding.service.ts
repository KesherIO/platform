import { Injectable } from '@nestjs/common';

@Injectable()
export class OnboardingService {
  // TODO: Inject PrismaService, TenantService, MailService
  getBranding(_tenantId: string): unknown {
    return { tenantName: 'TODO', logoUrl: null, primaryColor: null };
  }

  saveClinic(): unknown {
    return { clinicId: 'TODO' };
  }

  saveAdminProfile(): unknown {
    return { userId: 'TODO' };
  }

  saveStaffProfile(): unknown {
    return { userId: 'TODO' };
  }

  generateInvite(): unknown {
    return { token: 'TODO', expiresAt: null };
  }
}