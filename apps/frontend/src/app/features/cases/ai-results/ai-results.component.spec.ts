import { TestBed } from '@angular/core/testing';
import { AiResultsComponent } from './ai-results.component';
import { CasesService } from '../shared/services/cases.service';
import { CatalogService } from '../../../core/services/catalog.service';
import { ActivatedRoute, Router } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { signal } from '@angular/core';
import { CaseStatus, PatientSpecies, AgeUnit } from '@vet-ai/shared-types';

const MOCK_TRIAGE = {
  diagnoses: [
    { name: 'Gastroenteritis', confidence: 82, explanation: 'GI upset.' },
  ],
  suggestedCatalogItemIds: ['t1', 't2', 'p1'],
};

const MOCK_CASE = {
  id: 'c2',
  tenantId: 't1',
  status: CaseStatus.TRIAGED,
  patientName: 'Rocky',
  patientSpecies: PatientSpecies.DOG,
  patientAge: 7,
  patientAgeUnit: AgeUnit.YEARS,
  ownerName: 'Luis',
  symptoms: 'Limping',
  triageResult: MOCK_TRIAGE,
  createdByUserId: 'u1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const MOCK_CATALOG = [
  {
    id: 't1',
    kind: 'TEST' as const,
    code: 'CBC',
    name: 'Complete Blood Count',
    category: 'Hematology',
    turnaroundHours: 4,
    active: true,
  },
  {
    id: 't2',
    kind: 'TEST' as const,
    code: 'BMP',
    name: 'Basic Metabolic Panel',
    category: 'Chemistry',
    turnaroundHours: 6,
    active: true,
  },
  {
    id: 'p1',
    kind: 'PACKAGE' as const,
    name: 'Wellness Panel',
    description: 'Screening',
    active: true,
    components: [],
  },
];

describe('AiResultsComponent', () => {
  let casesServiceSpy: {
    getCase: ReturnType<typeof vi.fn>;
    updateCatalogSelection: ReturnType<typeof vi.fn>;
    triggerTriage: ReturnType<typeof vi.fn>;
    activeCase: ReturnType<typeof signal>;
  };
  let catalogServiceSpy: {
    loadCatalog: ReturnType<typeof vi.fn>;
    catalog: ReturnType<typeof signal>;
  };
  let routerSpy: { navigate: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    casesServiceSpy = {
      getCase: vi.fn().mockReturnValue(of(MOCK_CASE)),
      updateCatalogSelection: vi.fn().mockReturnValue(of(MOCK_CASE)),
      triggerTriage: vi.fn().mockReturnValue(of(MOCK_CASE)),
      activeCase: signal(null),
    };
    catalogServiceSpy = {
      loadCatalog: vi.fn().mockReturnValue(of(MOCK_CATALOG)),
      catalog: signal(null),
    };
    routerSpy = { navigate: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [AiResultsComponent],
      providers: [
        provideTranslateService({ defaultLanguage: 'en' }),
        { provide: CasesService, useValue: casesServiceSpy },
        { provide: CatalogService, useValue: catalogServiceSpy },
        { provide: Router, useValue: routerSpy },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => 'c2' } } },
        },
      ],
    }).compileComponents();
  });

  it('creates without error', () => {
    const fixture = TestBed.createComponent(AiResultsComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('pre-selects AI-suggested items on init', () => {
    const fixture = TestBed.createComponent(AiResultsComponent);
    fixture.detectChanges();
    const comp = fixture.componentInstance;
    expect(comp.selectedItemIds().has('t1')).toBe(true);
    expect(comp.selectedItemIds().has('t2')).toBe(true);
    expect(comp.selectedItemIds().has('p1')).toBe(true);
  });

  it('proceed() saves selections and navigates to order', () => {
    const fixture = TestBed.createComponent(AiResultsComponent);
    fixture.detectChanges();
    fixture.componentInstance.proceed();
    expect(casesServiceSpy.updateCatalogSelection).toHaveBeenCalledWith(
      'c2',
      expect.arrayContaining(['t1', 't2', 'p1'])
    );
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/cases', 'c2', 'order']);
  });

  it('isSuggested returns true for suggested ids', () => {
    const fixture = TestBed.createComponent(AiResultsComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.isSuggested('t1')).toBe(true);
    expect(fixture.componentInstance.isSuggested('t3')).toBe(false);
  });
});
