import { TestBed } from '@angular/core/testing';
import { TestSelectionComponent } from './test-selection.component';
import { CasesService } from '../shared/services/cases.service';
import { CatalogService } from '../../../core/services/catalog.service';
import { ActivatedRoute, Router } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { signal } from '@angular/core';
import { CaseStatus, PatientSpecies, AgeUnit } from '@vet-ai/shared-types';

const MOCK_CASE = {
  id: 'c1',
  tenantId: 't1',
  status: CaseStatus.TRIAGED,
  patientName: 'Max',
  patientSpecies: PatientSpecies.DOG,
  patientAge: 3,
  patientAgeUnit: AgeUnit.YEARS,
  ownerName: 'Carlos',
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
    description: 'Annual screening',
    active: true,
    components: [],
  },
];

describe('TestSelectionComponent', () => {
  let casesServiceSpy: {
    getCase: ReturnType<typeof vi.fn>;
    updateCatalogSelection: ReturnType<typeof vi.fn>;
    activeCase: ReturnType<typeof import('@angular/core').signal>;
  };
  let catalogServiceSpy: {
    loadCatalog: ReturnType<typeof vi.fn>;
    catalog: ReturnType<typeof import('@angular/core').signal>;
  };
  let routerSpy: { navigate: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    casesServiceSpy = {
      getCase: vi.fn().mockReturnValue(of(MOCK_CASE)),
      updateCatalogSelection: vi.fn().mockReturnValue(of(MOCK_CASE)),
      activeCase: signal(null),
    };
    catalogServiceSpy = {
      loadCatalog: vi.fn().mockReturnValue(of(MOCK_CATALOG)),
      catalog: signal(null),
    };
    routerSpy = { navigate: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [TestSelectionComponent],
      providers: [
        provideTranslateService({ defaultLanguage: 'en' }),
        { provide: CasesService, useValue: casesServiceSpy },
        { provide: CatalogService, useValue: catalogServiceSpy },
        { provide: Router, useValue: routerSpy },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => 'c1' } } },
        },
      ],
    }).compileComponents();
  });

  it('creates without error', () => {
    const fixture = TestBed.createComponent(TestSelectionComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('toggleItem adds/removes item id from selection', () => {
    const fixture = TestBed.createComponent(TestSelectionComponent);
    fixture.detectChanges();
    const comp = fixture.componentInstance;
    expect(comp.selectedItemIds().has('t1')).toBe(false);
    comp.toggleItem('t1');
    expect(comp.selectedItemIds().has('t1')).toBe(true);
    comp.toggleItem('t1');
    expect(comp.selectedItemIds().has('t1')).toBe(false);
  });

  it('proceed() calls updateCatalogSelection with selected ids and navigates to order', () => {
    const fixture = TestBed.createComponent(TestSelectionComponent);
    fixture.detectChanges();
    const comp = fixture.componentInstance;
    comp.toggleItem('t1');
    comp.proceed();
    expect(casesServiceSpy.updateCatalogSelection).toHaveBeenCalledWith('c1', [
      't1',
    ]);
    expect(routerSpy.navigate).toHaveBeenCalledWith(['/cases', 'c1', 'order']);
  });

  it('hasSelection is false when nothing is selected', () => {
    const fixture = TestBed.createComponent(TestSelectionComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.hasSelection()).toBe(false);
  });
});
