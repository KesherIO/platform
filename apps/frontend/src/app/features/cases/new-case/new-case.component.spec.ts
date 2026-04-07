import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { NewCaseComponent } from './new-case.component';
import { CasesService } from '../shared/services/cases.service';
import { TranslateModule } from '@ngx-translate/core';
import { RouterTestingModule } from '@angular/router/testing';
import {
  CaseStatus,
  PatientSpecies,
  AgeUnit,
  PatientSex,
} from '@vet-ai/shared-types';

const MOCK_CASE = {
  id: 'c1',
  tenantId: 't1',
  status: CaseStatus.TRIAGED,
  patientName: 'Luna',
  patientSpecies: PatientSpecies.CAT,
  patientBreed: 'Siamese',
  patientSex: PatientSex.FEMALE,
  patientAge: 5,
  patientAgeUnit: AgeUnit.YEARS,
  ownerName: 'Ana',
  ownerPhone: '+52 555 0001',
  createdByUserId: 'u1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('NewCaseComponent', () => {
  let fixture: ComponentFixture<NewCaseComponent>;
  let component: NewCaseComponent;
  let router: Router;
  let casesService: {
    searchCases: ReturnType<typeof vi.fn>;
    createCase: ReturnType<typeof vi.fn>;
    updateCase: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    // Reset history state before each test
    Object.defineProperty(window, 'history', {
      value: { state: {} },
      writable: true,
    });

    casesService = {
      searchCases: vi.fn().mockReturnValue(of([])),
      createCase: vi
        .fn()
        .mockReturnValue(of({ id: 'c99', status: CaseStatus.OPEN })),
      updateCase: vi
        .fn()
        .mockReturnValue(of({ id: 'c1', status: CaseStatus.OPEN })),
    };

    await TestBed.configureTestingModule({
      imports: [
        NewCaseComponent,
        ReactiveFormsModule,
        TranslateModule.forRoot(),
        RouterTestingModule,
      ],
      providers: [{ provide: CasesService, useValue: casesService }],
    }).compileComponents();

    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);

    fixture = TestBed.createComponent(NewCaseComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  // ── Creation & form validity ──────────────────────────────────────────────

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('form is invalid when required fields are empty', () => {
    expect(component.form.invalid).toBe(true);
  });

  it('form is valid when required fields are filled', () => {
    component.form.patchValue({
      patientName: 'Max',
      patientSpecies: 'DOG',
      ownerName: 'Jane',
    });
    expect(component.form.valid).toBe(true);
  });

  // ── DOB → age auto-calculation ────────────────────────────────────────────

  it('calculates age in years from date of birth', () => {
    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - 10);
    component.form
      .get('patientDateOfBirth')!
      .setValue(dob.toISOString().split('T')[0]);
    expect(component.form.get('patientAge')!.value).toBe(10);
    expect(component.form.get('patientAgeUnit')!.value).toBe(AgeUnit.YEARS);
  });

  it('calculates age in months for a patient under 1 year', () => {
    const dob = new Date();
    dob.setMonth(dob.getMonth() - 4);
    component.form
      .get('patientDateOfBirth')!
      .setValue(dob.toISOString().split('T')[0]);
    expect(component.form.get('patientAgeUnit')!.value).toBe(AgeUnit.MONTHS);
  });

  it('does not auto-calculate age when DOB is cleared', () => {
    component.form.get('patientDateOfBirth')!.setValue('');
    expect(component.form.get('patientAge')!.value).toBeNull();
  });

  // ── prefill from router state ─────────────────────────────────────────────

  it('prefills form from history.state.prefill on init', () => {
    Object.defineProperty(window, 'history', {
      value: {
        state: {
          prefill: {
            patientName: 'Max',
            patientSpecies: PatientSpecies.DOG,
            ownerName: 'Carlos',
          },
        },
      },
      writable: true,
    });
    const fixture2 = TestBed.createComponent(NewCaseComponent);
    fixture2.detectChanges();
    expect(fixture2.componentInstance.form.value.patientName).toBe('Max');
    expect(fixture2.componentInstance.form.value.ownerName).toBe('Carlos');
  });

  it('sets editCaseId from history.state on init', () => {
    Object.defineProperty(window, 'history', {
      value: {
        state: {
          editCaseId: 'c42',
          prefill: {
            patientName: 'Max',
            patientSpecies: PatientSpecies.DOG,
            ownerName: 'Carlos',
          },
        },
      },
      writable: true,
    });
    const fixture2 = TestBed.createComponent(NewCaseComponent);
    fixture2.detectChanges();
    expect(fixture2.componentInstance.editCaseId()).toBe('c42');
  });

  // ── submit — create ───────────────────────────────────────────────────────

  it('calls createCase on submit when no editCaseId', () => {
    component.form.patchValue({
      patientName: 'Max',
      patientSpecies: 'DOG',
      ownerName: 'Jane',
    });
    component.submit();
    expect(casesService.createCase).toHaveBeenCalledOnce();
    expect(casesService.updateCase).not.toHaveBeenCalled();
  });

  it('navigates to symptoms after createCase succeeds', () => {
    component.form.patchValue({
      patientName: 'Max',
      patientSpecies: 'DOG',
      ownerName: 'Jane',
    });
    component.submit();
    expect(router.navigate).toHaveBeenCalledWith(['/cases', 'c99', 'symptoms']);
  });

  it('does not submit when form is invalid', () => {
    component.submit();
    expect(casesService.createCase).not.toHaveBeenCalled();
  });

  it('does not submit when already saving', () => {
    component.form.patchValue({
      patientName: 'Max',
      patientSpecies: 'DOG',
      ownerName: 'Jane',
    });
    component.saving.set(true);
    component.submit();
    expect(casesService.createCase).not.toHaveBeenCalled();
  });

  // ── submit — update ───────────────────────────────────────────────────────

  it('calls updateCase on submit when editCaseId is set', () => {
    component.editCaseId.set('c1');
    component.form.patchValue({
      patientName: 'Max',
      patientSpecies: 'DOG',
      ownerName: 'Jane',
    });
    component.submit();
    expect(casesService.updateCase).toHaveBeenCalledWith(
      'c1',
      expect.any(Object)
    );
    expect(casesService.createCase).not.toHaveBeenCalled();
  });

  it('navigates to existing case symptoms after updateCase succeeds', () => {
    component.editCaseId.set('c1');
    component.form.patchValue({
      patientName: 'Max',
      patientSpecies: 'DOG',
      ownerName: 'Jane',
    });
    component.submit();
    expect(router.navigate).toHaveBeenCalledWith(['/cases', 'c1', 'symptoms']);
  });

  // ── selectExistingCase ────────────────────────────────────────────────────

  it('selectExistingCase fills the form with the selected case', () => {
    component.selectExistingCase(MOCK_CASE as any);
    expect(component.form.value.patientName).toBe('Luna');
    expect(component.form.value.ownerName).toBe('Ana');
  });

  it('selectExistingCase disables the form', () => {
    component.selectExistingCase(MOCK_CASE as any);
    expect(component.form.disabled).toBe(true);
  });

  it('selectExistingCase sets selectedCase signal', () => {
    component.selectExistingCase(MOCK_CASE as any);
    expect(component.selectedCase()).toEqual(MOCK_CASE);
  });

  it('selectExistingCase hides search results', () => {
    component.showResults.set(true);
    component.selectExistingCase(MOCK_CASE as any);
    expect(component.showResults()).toBe(false);
  });

  // ── clearSelection ────────────────────────────────────────────────────────

  it('clearSelection re-enables the form', () => {
    component.selectExistingCase(MOCK_CASE as any);
    component.clearSelection();
    expect(component.form.enabled).toBe(true);
  });

  it('clearSelection clears selectedCase', () => {
    component.selectExistingCase(MOCK_CASE as any);
    component.clearSelection();
    expect(component.selectedCase()).toBeNull();
  });

  it('clearSelection resets the form', () => {
    component.selectExistingCase(MOCK_CASE as any);
    component.clearSelection();
    expect(component.form.value.patientName).toBeFalsy();
  });

  // ── navigateNewCaseForPatient ─────────────────────────────────────────────

  it('navigateNewCaseForPatient navigates to /cases/new keeping patient data', () => {
    component.selectExistingCase(MOCK_CASE as any);
    component.newCaseForPatient();
    expect(component.selectedCase()).toBeNull();
    expect(component.form.enabled).toBe(true);
    expect(component.form.value.patientName).toBe('Luna');
  });

  // ── continueCase ──────────────────────────────────────────────────────────

  it('continueCase navigates to ai-results for a TRIAGED case', () => {
    component.selectExistingCase(MOCK_CASE as any);
    component.continueCase();
    expect(router.navigate).toHaveBeenCalledWith([
      '/cases',
      'c1',
      'ai-results',
    ]);
  });
});
