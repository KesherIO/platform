import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CaseWizardLayoutComponent } from './case-wizard-layout.component';
import { TranslateModule } from '@ngx-translate/core';
import { RouterTestingModule } from '@angular/router/testing';
import { PatientSpecies, AgeUnit } from '@vet-ai/shared-types';

describe('CaseWizardLayoutComponent', () => {
  let fixture: ComponentFixture<CaseWizardLayoutComponent>;
  let component: CaseWizardLayoutComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        CaseWizardLayoutComponent,
        TranslateModule.forRoot(),
        RouterTestingModule,
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(CaseWizardLayoutComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  // ── Creation ──────────────────────────────────────────────────────────────

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // ── Patient strip visibility ───────────────────────────────────────────────

  it('does not render patient strip when patientName is not provided', () => {
    expect(
      fixture.nativeElement.querySelector('[data-testid="patient-strip"]')
    ).toBeNull();
  });

  it('renders patient strip when patientName is provided', () => {
    fixture.componentRef.setInput('patientName', 'Max');
    fixture.componentRef.setInput('patientSpecies', PatientSpecies.DOG);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Max');
  });

  it('renders owner chip when ownerName is provided', () => {
    fixture.componentRef.setInput('patientName', 'Max');
    fixture.componentRef.setInput('ownerName', 'Carlos');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Carlos');
  });

  it('does not render owner chip when ownerName is not provided', () => {
    fixture.componentRef.setInput('patientName', 'Max');
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).not.toContain('Carlos');
  });

  it('renders breed and age in patient strip', () => {
    fixture.componentRef.setInput('patientName', 'Max');
    fixture.componentRef.setInput('patientBreed', 'Labrador');
    fixture.componentRef.setInput('patientAge', 3);
    fixture.componentRef.setInput('patientAgeUnit', AgeUnit.YEARS);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Labrador');
    expect(text).toContain('3');
  });

  // ── formatAge ─────────────────────────────────────────────────────────────

  it('formatAge returns empty string when age is undefined', () => {
    expect(component.formatAge(undefined, AgeUnit.YEARS)).toBe('');
  });

  it('formatAge formats age with lowercased unit', () => {
    expect(component.formatAge(3, AgeUnit.YEARS)).toBe('3 years');
  });

  it('formatAge formats months correctly', () => {
    expect(component.formatAge(6, AgeUnit.MONTHS)).toBe('6 months');
  });

  it('formatAge handles missing unit', () => {
    expect(component.formatAge(5, undefined)).toBe('5');
  });

  // ── default input values ──────────────────────────────────────────────────

  it('backRoute defaults to /cases', () => {
    expect(component.backRoute()).toBe('/cases');
  });

  it('titleKey defaults to empty string', () => {
    expect(component.titleKey()).toBe('');
  });

  it('renders title when titleKey is set', () => {
    fixture.componentRef.setInput('titleKey', 'CASES.SYMPTOMS.TITLE');
    fixture.detectChanges();
    // TranslateModule with no loader returns the key itself
    expect(fixture.nativeElement.textContent).toContain('CASES.SYMPTOMS.TITLE');
  });
});
