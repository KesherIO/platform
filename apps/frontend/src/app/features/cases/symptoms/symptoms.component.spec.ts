import { TestBed } from '@angular/core/testing';
import { SymptomsComponent } from './symptoms.component';
import { CasesService } from '../shared/services/cases.service';
import { ActivatedRoute, Router } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { signal } from '@angular/core';
import { CaseStatus, PatientSpecies, AgeUnit } from '@vet-ai/shared-types';

const MOCK_CASE = {
  id: 'c1',
  tenantId: 't1',
  status: CaseStatus.OPEN,
  patientName: 'Max',
  patientSpecies: PatientSpecies.DOG,
  patientAge: 3,
  patientAgeUnit: AgeUnit.YEARS,
  ownerName: 'Carlos',
  createdByUserId: 'u1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('SymptomsComponent', () => {
  let casesServiceSpy: {
    getCase: ReturnType<typeof vi.fn>;
    updateSymptoms: ReturnType<typeof vi.fn>;
    triggerTriage: ReturnType<typeof vi.fn>;
    activeCase: ReturnType<typeof signal>;
  };
  let routerSpy: { navigate: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    casesServiceSpy = {
      getCase: vi.fn().mockReturnValue(of(MOCK_CASE)),
      updateSymptoms: vi.fn().mockReturnValue(of(MOCK_CASE)),
      triggerTriage: vi
        .fn()
        .mockReturnValue(of({ ...MOCK_CASE, status: CaseStatus.TRIAGED })),
      activeCase: signal(null),
    };
    routerSpy = { navigate: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [SymptomsComponent],
      providers: [
        provideTranslateService({ defaultLanguage: 'en' }),
        { provide: CasesService, useValue: casesServiceSpy },
        { provide: Router, useValue: routerSpy },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => 'c1' } } },
        },
      ],
    }).compileComponents();
  });

  it('creates without error', () => {
    const fixture = TestBed.createComponent(SymptomsComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('loads case on init and pre-fills symptoms', () => {
    const caseWithSymptoms = { ...MOCK_CASE, symptoms: 'Vomiting' };
    casesServiceSpy.getCase.mockReturnValue(of(caseWithSymptoms));
    const fixture = TestBed.createComponent(SymptomsComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.form.value.symptoms).toBe('Vomiting');
  });

  it('runAi() saves symptoms then triggers triage and navigates to ai-results', () => {
    const fixture = TestBed.createComponent(SymptomsComponent);
    fixture.detectChanges();
    fixture.componentInstance.form.patchValue({ symptoms: 'Lethargy' });
    fixture.componentInstance.runAi();
    expect(casesServiceSpy.updateSymptoms).toHaveBeenCalledWith(
      'c1',
      'Lethargy'
    );
    expect(casesServiceSpy.triggerTriage).toHaveBeenCalledWith('c1');
    expect(routerSpy.navigate).toHaveBeenCalledWith([
      '/cases',
      'c1',
      'ai-results',
    ]);
  });

  it('skipAi() saves symptoms and navigates to test-selection', () => {
    const fixture = TestBed.createComponent(SymptomsComponent);
    fixture.detectChanges();
    fixture.componentInstance.form.patchValue({ symptoms: 'Lethargy' });
    fixture.componentInstance.skipAi();
    expect(casesServiceSpy.updateSymptoms).toHaveBeenCalledWith(
      'c1',
      'Lethargy'
    );
    expect(routerSpy.navigate).toHaveBeenCalledWith([
      '/cases',
      'c1',
      'test-selection',
    ]);
  });
});
