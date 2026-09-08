import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
  Router,
} from '@angular/router';
import { of, firstValueFrom } from 'rxjs';
import { Observable } from 'rxjs';
import { signal } from '@angular/core';
import { authGuard } from './auth.guard';
import { AuthService, MeResponse } from '../services/auth.service';
import { TenantService } from '../services/tenant.service';

const mockRoute = {} as ActivatedRouteSnapshot;
const mockState = { url: '/dashboard' } as RouterStateSnapshot;

function makeMembership(
  tenantId: string,
  role: string,
  status: string,
  vetStatus?: string
): MeResponse['memberships'][0] {
  return {
    role,
    status,
    isOrderingVet: role === 'VET',
    vetVerification: vetStatus
      ? { status: vetStatus, rejectionReason: null }
      : null,
    createdAt: '',
    tenant: {
      id: tenantId,
      name: 'Clinic',
      slug: 'clinic',
      logoUrl: null,
      primaryColor: null,
    },
  };
}

function makeMe(memberships: MeResponse['memberships']): MeResponse {
  return {
    user: {
      id: 'u1',
      email: 'test@test.com',
      firstName: 'Test',
      lastName: 'User',
      createdAt: '',
    },
    memberships,
    tenants: memberships.map((m) => m.tenant),
    onboardingCompleted: true,
    activeTenantId: memberships[0]?.tenant.id ?? null,
  };
}

describe('authGuard — membership status routing', () => {
  let router: { navigate: ReturnType<typeof vi.fn> };

  function setup(
    me: MeResponse | null,
    tenantOverrides: Record<string, unknown> = {}
  ) {
    router = { navigate: vi.fn() };

    const activeMembership = me?.memberships[0] ?? null;
    const mockTenant = {
      activeTenantId: signal(activeMembership?.tenant.id ?? null),
      activeMembership: signal(activeMembership),
      needsClinicSelection: signal(false),
      clinics: signal(me?.memberships ?? []),
      hasMultipleClinics: signal((me?.memberships?.length ?? 0) > 1),
      ...tenantOverrides,
    };

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
        { provide: TenantService, useValue: mockTenant },
        { provide: Router, useValue: router },
      ],
    });
  }

  it('ACTIVE membership allows access', async () => {
    setup(makeMe([makeMembership('t1', 'VET', 'ACTIVE')]));
    const result = await firstValueFrom(
      TestBed.runInInjectionContext(() =>
        authGuard(mockRoute, mockState)
      ) as Observable<boolean>
    );
    expect(result).toBe(true);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('PROFILE_REQUIRED redirects to /onboarding/vet-profile and returns false', async () => {
    setup(makeMe([makeMembership('t1', 'VET', 'PROFILE_REQUIRED')]));
    const result = await firstValueFrom(
      TestBed.runInInjectionContext(() =>
        authGuard(mockRoute, mockState)
      ) as Observable<boolean>
    );
    expect(result).toBe(false);
    expect(router.navigate).toHaveBeenCalledWith(['/onboarding/vet-profile']);
  });

  it('VERIFICATION_PENDING redirects to /onboarding/verification-pending', async () => {
    setup(
      makeMe([makeMembership('t1', 'VET', 'VERIFICATION_PENDING', 'PENDING')])
    );
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
    setup(
      makeMe([makeMembership('t1', 'VET', 'VERIFICATION_PENDING', 'REJECTED')])
    );
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
    setup(makeMe([]));
    const result = await firstValueFrom(
      TestBed.runInInjectionContext(() =>
        authGuard(mockRoute, mockState)
      ) as Observable<boolean>
    );
    expect(result).toBe(false);
    expect(router.navigate).toHaveBeenCalledWith(['/no-clinic']);
  });

  it('needsClinicSelection redirects to /select-clinic', async () => {
    const me = makeMe([
      makeMembership('t1', 'VET', 'ACTIVE'),
      makeMembership('t2', 'ADMIN', 'ACTIVE'),
    ]);
    setup(me, {
      activeTenantId: signal(null),
      activeMembership: signal(null),
      needsClinicSelection: signal(true),
    });
    const result = await firstValueFrom(
      TestBed.runInInjectionContext(() =>
        authGuard(mockRoute, mockState)
      ) as Observable<boolean>
    );
    expect(result).toBe(false);
    expect(router.navigate).toHaveBeenCalledWith(['/select-clinic']);
  });
});
