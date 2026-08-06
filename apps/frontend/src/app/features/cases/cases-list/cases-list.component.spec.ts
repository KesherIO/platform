import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CasesListComponent } from './cases-list.component';
import { TranslateModule } from '@ngx-translate/core';
import { RouterTestingModule } from '@angular/router/testing';
import { CasesService } from '../shared/services/cases.service';
import { of, throwError } from 'rxjs';
import { CaseStatus, PatientSpecies, AgeUnit } from '@vet-ai/shared-types';

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

describe('CasesListComponent', () => {
  let fixture: ComponentFixture<CasesListComponent>;
  let component: CasesListComponent;
  let casesServiceSpy: {
    listCases: ReturnType<typeof vi.fn>;
    deleteCase: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    casesServiceSpy = {
      listCases: vi.fn().mockReturnValue(of(MOCK_CASES)),
      deleteCase: vi.fn().mockReturnValue(of(null)),
    };

    await TestBed.configureTestingModule({
      imports: [
        CasesListComponent,
        TranslateModule.forRoot(),
        RouterTestingModule,
      ],
      providers: [{ provide: CasesService, useValue: casesServiceSpy }],
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

  it('onDocumentClick closes card menus', () => {
    component.openMenuId.set('c1');
    component.onDocumentClick();
    expect(component.openMenuId()).toBeNull();
  });
});
