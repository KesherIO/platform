import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CaseCardComponent } from './case-card.component';
import { TranslateModule } from '@ngx-translate/core';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import {
  CaseStatus,
  PatientSpecies,
  AgeUnit,
  PatientSex,
} from '@vet-ai/shared-types';

const MOCK_CASE = {
  id: 'c1',
  tenantId: 'tenant1',
  status: CaseStatus.OPEN,
  patientName: 'Max',
  patientSpecies: PatientSpecies.DOG,
  patientBreed: 'Labrador',
  patientSex: PatientSex.MALE,
  patientAge: 3,
  patientAgeUnit: AgeUnit.YEARS,
  patientWeight: 28,
  ownerName: 'Carlos',
  createdByUserId: 'u1',
  createdAt: new Date('2026-04-01'),
  updatedAt: new Date('2026-04-01'),
};

const EXPECTED_PREFILL = {
  patientName: 'Max',
  patientSpecies: PatientSpecies.DOG,
  patientSex: PatientSex.MALE,
  patientBreed: 'Labrador',
  patientAge: 3,
  patientAgeUnit: AgeUnit.YEARS,
  ownerName: 'Carlos',
};

describe('CaseCardComponent', () => {
  let fixture: ComponentFixture<CaseCardComponent>;
  let component: CaseCardComponent;
  let router: Router;

  const setup = async (caseOverride: Partial<typeof MOCK_CASE> = {}) => {
    await TestBed.configureTestingModule({
      imports: [
        CaseCardComponent,
        TranslateModule.forRoot(),
        RouterTestingModule,
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(CaseCardComponent);
    component = fixture.componentInstance;
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture.componentRef.setInput('case', { ...MOCK_CASE, ...caseOverride });
    fixture.componentRef.setInput('route', ['/cases', 'c1', 'symptoms']);
    fixture.detectChanges();
  };

  beforeEach(() => setup());

  // ── Creation & rendering ──────────────────────────────────────────────────

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('renders patient name', () => {
    expect(fixture.nativeElement.textContent).toContain('Max');
  });

  it('renders owner name', () => {
    expect(fixture.nativeElement.textContent).toContain('Carlos');
  });

  // ── menuOpen computed ─────────────────────────────────────────────────────

  it('menuOpen is false when openMenuId does not match', () => {
    fixture.componentRef.setInput('menuOpenId', 'c99');
    expect(component.menuOpen()).toBe(false);
  });

  it('menuOpen is true when openMenuId matches case id', () => {
    fixture.componentRef.setInput('menuOpenId', 'c1');
    expect(component.menuOpen()).toBe(true);
  });

  // ── toggleMenu ────────────────────────────────────────────────────────────

  it('toggleMenu emits case id when menu is closed', () => {
    const emitted: (string | null)[] = [];
    component.menuToggled.subscribe((v) => emitted.push(v));
    fixture.componentRef.setInput('menuOpenId', null);
    component.toggleMenu(new MouseEvent('click'));
    expect(emitted).toEqual(['c1']);
  });

  it('toggleMenu emits null when menu is already open', () => {
    const emitted: (string | null)[] = [];
    component.menuToggled.subscribe((v) => emitted.push(v));
    fixture.componentRef.setInput('menuOpenId', 'c1');
    component.toggleMenu(new MouseEvent('click'));
    expect(emitted).toEqual([null]);
  });

  // ── navigate — OPEN case ──────────────────────────────────────────────────

  it('navigate redirects OPEN case to /cases/new with editCaseId and prefill', () => {
    component.navigate(['/cases', 'c1', 'symptoms']);
    expect(router.navigate).toHaveBeenCalledWith(['/cases/new'], {
      state: { editCaseId: 'c1', prefill: EXPECTED_PREFILL },
    });
  });

  it('navigate emits null to close menu before navigating', () => {
    const emitted: (string | null)[] = [];
    component.menuToggled.subscribe((v) => emitted.push(v));
    component.navigate(['/cases', 'c1', 'symptoms']);
    expect(emitted).toEqual([null]);
  });

  // ── navigate — non-OPEN cases ─────────────────────────────────────────────

  it('navigate goes directly to path for TRIAGED case', async () => {
    TestBed.resetTestingModule();
    await setup({ status: CaseStatus.TRIAGED });
    component.navigate(['/cases', 'c1', 'ai-results']);
    expect(router.navigate).toHaveBeenCalledWith([
      '/cases',
      'c1',
      'ai-results',
    ]);
  });

  it('navigate goes directly to path for OPEN case on non-symptoms route', () => {
    component.navigate(['/cases', 'c1', 'order']);
    expect(router.navigate).toHaveBeenCalledWith(['/cases', 'c1', 'order']);
  });

  // ── navigateNewCaseForPatient ─────────────────────────────────────────────

  it('navigateNewCaseForPatient navigates to /cases/new with prefill only', () => {
    component.navigateNewCaseForPatient();
    expect(router.navigate).toHaveBeenCalledWith(['/cases/new'], {
      state: { prefill: EXPECTED_PREFILL },
    });
  });

  it('navigateNewCaseForPatient emits null to close menu', () => {
    const emitted: (string | null)[] = [];
    component.menuToggled.subscribe((v) => emitted.push(v));
    component.navigateNewCaseForPatient();
    expect(emitted).toEqual([null]);
  });

  // ── formatDate ────────────────────────────────────────────────────────────

  it('formatDate returns "Today" for today', () => {
    expect(component.formatDate(new Date())).toBe('Today');
  });

  it('formatDate returns "1d" for yesterday', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(component.formatDate(yesterday)).toBe('1d');
  });

  it('formatDate returns Nd for days within the same week', () => {
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    expect(component.formatDate(threeDaysAgo)).toBe('3d');
  });

  it('formatDate returns short date for same year', () => {
    const date = new Date();
    date.setDate(date.getDate() - 10);
    const result = component.formatDate(date);
    expect(result).toMatch(/^\w{3} \d{2}$/); // e.g. "Mar 28"
  });

  it('formatDate accepts a date string', () => {
    expect(component.formatDate(new Date().toISOString())).toBe('Today');
  });

  // ── formatAge ─────────────────────────────────────────────────────────────

  it('formatAge returns empty string when age is undefined', () => {
    expect(component.formatAge(undefined, 'years')).toBe('');
  });

  it('formatAge returns formatted string with lowercased unit', () => {
    expect(component.formatAge(3, 'YEARS')).toBe('3 years');
  });

  it('formatAge handles missing unit gracefully', () => {
    expect(component.formatAge(5, undefined)).toBe('5 ');
  });
});
