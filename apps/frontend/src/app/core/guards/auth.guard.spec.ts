import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
  Router,
} from '@angular/router';
import { of, firstValueFrom } from 'rxjs';
import { Observable } from 'rxjs';
import { authGuard } from './auth.guard';
import { AuthService, MeResponse } from '../services/auth.service';

const mockRoute = {} as ActivatedRouteSnapshot;
const mockState = { url: '/dashboard' } as RouterStateSnapshot;

function makeMe(membershipStatus: string, vetStatus?: string): MeResponse {
  return {
    user: {
      id: 'u1',
      email: 'test@test.com',
      firstName: 'Test',
      lastName: 'User',
      createdAt: '',
    },
    memberships: [
      {
        role: 'VET',
        status: membershipStatus,
        isOrderingVet: true,
        vetVerification: vetStatus
          ? { status: vetStatus, rejectionReason: null }
          : null,
        createdAt: '',
        tenant: {
          id: 't1',
          name: 'Clinic A',
          slug: 'clinic-a',
          logoUrl: null,
          primaryColor: null,
        },
      },
    ],
    tenants: [],
    onboardingCompleted: true,
    activeTenantId: 't1',
  };
}

describe('authGuard — membership status routing', () => {
  let router: { navigate: ReturnType<typeof vi.fn> };

  function setup(me: MeResponse | null) {
    router = { navigate: vi.fn() };
    const mockAuth = {
      sessionReady$: of(undefined as void),
      isLoggedIn: vi.fn().mockReturnValue(true),
      me: vi.fn().mockReturnValue(me),
      loadMe: vi.fn().mockReturnValue(of(me)),
      signOut: vi.fn().mockReturnValue(of(undefined)),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: mockAuth },
        { provide: Router, useValue: router },
      ],
    });
  }

  it('ACTIVE membership allows access', async () => {
    setup(makeMe('ACTIVE'));
    const result = await firstValueFrom(
      TestBed.runInInjectionContext(() =>
        authGuard(mockRoute, mockState)
      ) as Observable<boolean>
    );
    expect(result).toBe(true);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('PROFILE_REQUIRED redirects to /onboarding/vet-profile and returns false', async () => {
    setup(makeMe('PROFILE_REQUIRED'));
    const result = await firstValueFrom(
      TestBed.runInInjectionContext(() =>
        authGuard(mockRoute, mockState)
      ) as Observable<boolean>
    );
    expect(result).toBe(false);
    expect(router.navigate).toHaveBeenCalledWith(['/onboarding/vet-profile']);
  });

  it('VERIFICATION_PENDING redirects to /onboarding/verification-pending', async () => {
    setup(makeMe('VERIFICATION_PENDING', 'PENDING'));
    const result = await firstValueFrom(
      TestBed.runInInjectionContext(() =>
        authGuard(mockRoute, mockState)
      ) as Observable<boolean>
    );
    expect(result).toBe(false);
    expect(router.navigate).toHaveBeenCalledWith([
      '/onboarding/verification-pending',
    ]);
  });

  it('VERIFICATION_PENDING with REJECTED status redirects to /onboarding/verification-rejected', async () => {
    setup(makeMe('VERIFICATION_PENDING', 'REJECTED'));
    const result = await firstValueFrom(
      TestBed.runInInjectionContext(() =>
        authGuard(mockRoute, mockState)
      ) as Observable<boolean>
    );
    expect(result).toBe(false);
    expect(router.navigate).toHaveBeenCalledWith([
      '/onboarding/verification-rejected',
    ]);
  });

  it('no memberships redirects to /no-clinic', async () => {
    setup({ ...makeMe('ACTIVE'), memberships: [] });
    const result = await firstValueFrom(
      TestBed.runInInjectionContext(() =>
        authGuard(mockRoute, mockState)
      ) as Observable<boolean>
    );
    expect(result).toBe(false);
    expect(router.navigate).toHaveBeenCalledWith(['/no-clinic']);
  });
});
