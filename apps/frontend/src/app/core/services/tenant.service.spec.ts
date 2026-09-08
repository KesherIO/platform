import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { TenantService } from './tenant.service';
import { MeResponse } from './auth.service';

function makeMembership(
  tenantId: string,
  name: string,
  role: string,
  status = 'ACTIVE'
): MeResponse['memberships'][0] {
  return {
    role,
    status,
    isOrderingVet: role === 'VET',
    createdAt: '',
    tenant: {
      id: tenantId,
      name,
      slug: name.toLowerCase().replace(/\s+/g, '-'),
      logoUrl: null,
      primaryColor: null,
    },
  };
}

function makeMe(
  memberships: MeResponse['memberships'],
  userId = 'u1'
): MeResponse {
  return {
    user: {
      id: userId,
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

describe('TenantService', () => {
  let service: TenantService;
  let router: { navigate: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    localStorage.clear();
    router = { navigate: vi.fn() };

    TestBed.configureTestingModule({
      providers: [{ provide: Router, useValue: router }],
    });
    service = TestBed.inject(TenantService);
  });

  afterEach(() => localStorage.clear());

  describe('resolve()', () => {
    it('auto-selects when user has one clinic', () => {
      const me = makeMe([makeMembership('t1', 'Clinic A', 'VET')]);
      service.resolve(me);

      expect(service.activeTenantId()).toBe('t1');
      expect(service.needsClinicSelection()).toBe(false);
      expect(service.hasMultipleClinics()).toBe(false);
    });

    it('requires selection when user has multiple clinics and no saved preference', () => {
      const me = makeMe([
        makeMembership('t1', 'Clinic A', 'VET'),
        makeMembership('t2', 'Clinic B', 'ADMIN'),
      ]);
      service.resolve(me);

      expect(service.activeTenantId()).toBeNull();
      expect(service.needsClinicSelection()).toBe(true);
      expect(service.hasMultipleClinics()).toBe(true);
    });

    it('uses valid saved selection for multi-clinic user', () => {
      localStorage.setItem('kesherio:active-clinic:u1', 't2');
      const me = makeMe([
        makeMembership('t1', 'Clinic A', 'VET'),
        makeMembership('t2', 'Clinic B', 'ADMIN'),
      ]);
      service.resolve(me);

      expect(service.activeTenantId()).toBe('t2');
      expect(service.needsClinicSelection()).toBe(false);
    });

    it('discards invalid saved selection and requires re-selection', () => {
      localStorage.setItem('kesherio:active-clinic:u1', 'deleted-tenant');
      const me = makeMe([
        makeMembership('t1', 'Clinic A', 'VET'),
        makeMembership('t2', 'Clinic B', 'ADMIN'),
      ]);
      service.resolve(me);

      expect(service.activeTenantId()).toBeNull();
      expect(service.needsClinicSelection()).toBe(true);
      expect(localStorage.getItem('kesherio:active-clinic:u1')).toBeNull();
    });

    it('auto-selects single remaining clinic when saved selection is invalid', () => {
      localStorage.setItem('kesherio:active-clinic:u1', 'deleted-tenant');
      const me = makeMe([makeMembership('t1', 'Clinic A', 'VET')]);
      service.resolve(me);

      expect(service.activeTenantId()).toBe('t1');
      expect(service.needsClinicSelection()).toBe(false);
    });

    it('handles zero clinics', () => {
      const me = makeMe([]);
      service.resolve(me);

      expect(service.activeTenantId()).toBeNull();
      expect(service.needsClinicSelection()).toBe(false);
      expect(service.clinics()).toEqual([]);
    });
  });

  describe('activeMembership()', () => {
    it('returns the membership for the active clinic', () => {
      localStorage.setItem('kesherio:active-clinic:u1', 't2');
      const me = makeMe([
        makeMembership('t1', 'Clinic A', 'VET'),
        makeMembership('t2', 'Clinic B', 'ADMIN'),
      ]);
      service.resolve(me);

      expect(service.activeMembership()?.role).toBe('ADMIN');
      expect(service.activeMembership()?.tenant.id).toBe('t2');
    });

    it('returns null when no clinic is selected', () => {
      const me = makeMe([
        makeMembership('t1', 'Clinic A', 'VET'),
        makeMembership('t2', 'Clinic B', 'ADMIN'),
      ]);
      service.resolve(me);

      expect(service.activeMembership()).toBeNull();
    });

    it('reflects different roles across clinics', () => {
      localStorage.setItem('kesherio:active-clinic:u1', 't1');
      const me = makeMe([
        makeMembership('t1', 'Clinic A', 'TECHNICIAN'),
        makeMembership('t2', 'Clinic B', 'ADMIN'),
      ]);
      service.resolve(me);
      expect(service.activeMembership()?.role).toBe('TECHNICIAN');

      service.selectClinic('t2');
      expect(service.activeMembership()?.role).toBe('ADMIN');
    });
  });

  describe('selectClinic()', () => {
    it('updates signals and persists to localStorage', () => {
      const me = makeMe([
        makeMembership('t1', 'Clinic A', 'VET'),
        makeMembership('t2', 'Clinic B', 'ADMIN'),
      ]);
      service.resolve(me);

      service.selectClinic('t2');

      expect(service.activeTenantId()).toBe('t2');
      expect(service.needsClinicSelection()).toBe(false);
      expect(localStorage.getItem('kesherio:active-clinic:u1')).toBe('t2');
    });

    it('navigates to dashboard', () => {
      const me = makeMe([
        makeMembership('t1', 'Clinic A', 'VET'),
        makeMembership('t2', 'Clinic B', 'ADMIN'),
      ]);
      service.resolve(me);
      service.selectClinic('t2');

      expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
    });

    it('invokes registered cache cleaners', () => {
      const cleaner = vi.fn();
      service.registerCacheCleaner(cleaner);

      const me = makeMe([
        makeMembership('t1', 'Clinic A', 'VET'),
        makeMembership('t2', 'Clinic B', 'ADMIN'),
      ]);
      service.resolve(me);
      service.selectClinic('t2');

      expect(cleaner).toHaveBeenCalledOnce();
    });

    it('ignores invalid tenantId', () => {
      const me = makeMe([
        makeMembership('t1', 'Clinic A', 'VET'),
        makeMembership('t2', 'Clinic B', 'ADMIN'),
      ]);
      service.resolve(me);
      service.selectClinic('nonexistent');

      expect(service.activeTenantId()).toBeNull();
      expect(router.navigate).not.toHaveBeenCalled();
    });
  });

  describe('clearSelection()', () => {
    it('resets in-memory state', () => {
      const me = makeMe([makeMembership('t1', 'Clinic A', 'VET')]);
      service.resolve(me);
      expect(service.activeTenantId()).toBe('t1');

      service.clearSelection();

      expect(service.activeTenantId()).toBeNull();
      expect(service.clinics()).toEqual([]);
    });
  });

  describe('savePreference (static)', () => {
    it('writes to localStorage', () => {
      TenantService.savePreference('u1', 't1');
      expect(localStorage.getItem('kesherio:active-clinic:u1')).toBe('t1');
    });
  });
});
