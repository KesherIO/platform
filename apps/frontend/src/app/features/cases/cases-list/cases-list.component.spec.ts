import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CasesListComponent } from './cases-list.component';
import { TranslateModule } from '@ngx-translate/core';
import { RouterTestingModule } from '@angular/router/testing';
import { CasesService } from '../shared/services/cases.service';
import { AuthService } from '../../../core/services/auth.service';
import { of, throwError } from 'rxjs';
import { CaseStatus, PatientSpecies, AgeUnit } from '@vet-ai/shared-types';
import { signal } from '@angular/core';

const MOCK_CASES = [
  {
    id: 'c1',
    tenantId: 't1',
    status: CaseStatus.OPEN,
    patientName: 'Max',
    patientSpecies: PatientSpecies.DOG,
    patientAge: 3,
    patientAgeUnit: AgeUnit.YEARS,
    ownerName: 'Carlos',
    createdByUserId: 'u1',
    createdAt: new Date('2026-04-03'),
    updatedAt: new Date('2026-04-03'),
  },
  {
    id: 'c2',
    tenantId: 't1',
    status: CaseStatus.ORDERED,
    patientName: 'Luna',
    patientSpecies: PatientSpecies.CAT,
    patientAge: 5,
    patientAgeUnit: AgeUnit.YEARS,
    ownerName: 'Ana',
    createdByUserId: 'u1',
    createdAt: new Date('2026-04-01'),
    updatedAt: new Date('2026-04-01'),
  },
  {
    id: 'c3',
    tenantId: 't1',
    status: CaseStatus.TRIAGED,
    patientName: 'Rocky',
    patientSpecies: PatientSpecies.DOG,
    patientAge: 7,
    patientAgeUnit: AgeUnit.YEARS,
    ownerName: 'Carlos',
    createdByUserId: 'u1',
    createdAt: new Date('2026-04-02'),
    updatedAt: new Date('2026-04-02'),
  },
];

const MOCK_ME = {
  user: { firstName: 'Karina', lastName: 'Martinez', email: 'k@test.com' },
  memberships: [],
  tenants: [{ id: 't1', name: 'VetClinic', logoUrl: 'logo.png' }],
  onboardingCompleted: true,
  activeTenantId: 't1',
};

describe('CasesListComponent', () => {
  let fixture: ComponentFixture<CasesListComponent>;
  let component: CasesListComponent;
  let casesServiceSpy: {
    listCases: ReturnType<typeof vi.fn>;
    signOut?: ReturnType<typeof vi.fn>;
  };
  let authServiceSpy: {
    me: ReturnType<typeof signal>;
    signOut: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    casesServiceSpy = { listCases: vi.fn().mockReturnValue(of(MOCK_CASES)) };
    authServiceSpy = {
      me: signal(MOCK_ME),
      signOut: vi.fn().mockReturnValue(of(null)),
    };

    await TestBed.configureTestingModule({
      imports: [
        CasesListComponent,
        TranslateModule.forRoot(),
        RouterTestingModule,
      ],
      providers: [
        { provide: CasesService, useValue: casesServiceSpy },
        { provide: AuthService, useValue: authServiceSpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CasesListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  // ── Creation ───────────────────────────────────────────────────────────────

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // ── ngOnInit / data loading ────────────────────────────────────────────────

  it('loads cases on init and clears loading flag', () => {
    expect(casesServiceSpy.listCases).toHaveBeenCalledOnce();
    expect(component.allCases().length).toBe(3);
    expect(component.loading()).toBe(false);
  });

  it('sets error signal when listCases fails', async () => {
    casesServiceSpy.listCases.mockReturnValue(
      throwError(() => new Error('network'))
    );
    const fixture2 = TestBed.createComponent(CasesListComponent);
    fixture2.detectChanges();
    expect(fixture2.componentInstance.error()).toBe('error');
    expect(fixture2.componentInstance.loading()).toBe(false);
  });

  // ── filteredCases — search ────────────────────────────────────────────────

  it('returns all cases when search is empty', () => {
    expect(component.filteredCases().length).toBe(3);
  });

  it('filters by patient name (case-insensitive)', () => {
    component.search.set('luna');
    expect(component.filteredCases().length).toBe(1);
    expect(component.filteredCases()[0].id).toBe('c2');
  });

  it('filters by owner name', () => {
    component.search.set('Ana');
    expect(component.filteredCases().length).toBe(1);
    expect(component.filteredCases()[0].id).toBe('c2');
  });

  it('filters by case id', () => {
    component.search.set('c3');
    expect(component.filteredCases().length).toBe(1);
    expect(component.filteredCases()[0].id).toBe('c3');
  });

  it('returns empty list when no cases match search', () => {
    component.search.set('zzznomatch');
    expect(component.filteredCases().length).toBe(0);
  });

  // ── filteredCases — status filter ─────────────────────────────────────────

  it('filters by status OPEN', () => {
    component.statusFilter.set(CaseStatus.OPEN);
    const result = component.filteredCases();
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('c1');
  });

  it('filters by status TRIAGED', () => {
    component.statusFilter.set(CaseStatus.TRIAGED);
    expect(component.filteredCases()[0].id).toBe('c3');
  });

  it('clears status filter when set to null', () => {
    component.statusFilter.set(CaseStatus.OPEN);
    component.statusFilter.set(null);
    expect(component.filteredCases().length).toBe(3);
  });

  // ── filteredCases — species filter ────────────────────────────────────────

  it('filters by species CAT', () => {
    component.speciesFilter.set(PatientSpecies.CAT);
    const result = component.filteredCases();
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('c2');
  });

  it('filters by species DOG', () => {
    component.speciesFilter.set(PatientSpecies.DOG);
    expect(component.filteredCases().length).toBe(2);
  });

  // ── filteredCases — combined filters ─────────────────────────────────────

  it('applies search and status filter together', () => {
    component.search.set('Carlos');
    component.statusFilter.set(CaseStatus.OPEN);
    const result = component.filteredCases();
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('c1');
  });

  // ── filteredCases — sorting ───────────────────────────────────────────────

  it('sorts by date descending by default', () => {
    const ids = component.filteredCases().map((c) => c.id);
    expect(ids).toEqual(['c1', 'c3', 'c2']); // 04-03, 04-02, 04-01
  });

  it('sorts by date ascending', () => {
    component.sort.set('date-asc');
    const ids = component.filteredCases().map((c) => c.id);
    expect(ids).toEqual(['c2', 'c3', 'c1']); // 04-01, 04-02, 04-03
  });

  it('sorts by patient name ascending', () => {
    component.sort.set('name-asc');
    const names = component.filteredCases().map((c) => c.patientName);
    expect(names).toEqual(['Luna', 'Max', 'Rocky']);
  });

  // ── routeForCase ──────────────────────────────────────────────────────────

  it('routeForCase returns symptoms path for OPEN', () => {
    expect(component.routeForCase(MOCK_CASES[0] as any)).toEqual([
      '/cases',
      'c1',
      'symptoms',
    ]);
  });

  it('routeForCase returns ai-results path for TRIAGED', () => {
    expect(component.routeForCase(MOCK_CASES[2] as any)).toEqual([
      '/cases',
      'c3',
      'ai-results',
    ]);
  });

  it('routeForCase returns order path for ORDERED', () => {
    expect(component.routeForCase(MOCK_CASES[1] as any)).toEqual([
      '/cases',
      'c2',
      'order',
    ]);
  });

  // ── menu state ────────────────────────────────────────────────────────────

  it('openMenuId starts as null', () => {
    expect(component.openMenuId()).toBeNull();
  });

  it('menuOpen starts as false', () => {
    expect(component.menuOpen()).toBe(false);
  });

  it('onDocumentClick closes avatar menu and card menus', () => {
    component.menuOpen.set(true);
    component.openMenuId.set('c1');
    component.onDocumentClick();
    expect(component.menuOpen()).toBe(false);
    expect(component.openMenuId()).toBeNull();
  });

  // ── auth computed values ──────────────────────────────────────────────────

  it('userInitial returns first letter of firstName', () => {
    expect(component.userInitial()).toBe('K');
  });

  it('userInitial falls back to email when no firstName', () => {
    authServiceSpy.me.set({ ...MOCK_ME, user: { email: 'test@example.com' } });
    expect(component.userInitial()).toBe('T');
  });

  it('userInitial returns ? when not logged in', () => {
    authServiceSpy.me.set(null);
    expect(component.userInitial()).toBe('?');
  });

  it('userDisplayName returns full name', () => {
    expect(component.userDisplayName()).toBe('Karina Martinez');
  });

  it('userDisplayName falls back to email when no name', () => {
    authServiceSpy.me.set({ ...MOCK_ME, user: { email: 'test@example.com' } });
    expect(component.userDisplayName()).toBe('test@example.com');
  });

  it('tenantName returns tenant name', () => {
    expect(component.tenantName()).toBe('VetClinic');
  });

  it('tenantName returns fallback when no tenants', () => {
    authServiceSpy.me.set({ ...MOCK_ME, tenants: [] });
    expect(component.tenantName()).toBe('LabX Copilot');
  });

  it('tenantLogoUrl returns tenant logo', () => {
    expect(component.tenantLogoUrl()).toBe('logo.png');
  });

  it('tenantLogoUrl returns default logo when no tenants', () => {
    authServiceSpy.me.set({ ...MOCK_ME, tenants: [] });
    expect(component.tenantLogoUrl()).toBe('assets/icons/default_logo.png');
  });

  // ── signOut ───────────────────────────────────────────────────────────────

  it('signOut calls authService.signOut', () => {
    component.signOut();
    expect(authServiceSpy.signOut).toHaveBeenCalledOnce();
  });
});
