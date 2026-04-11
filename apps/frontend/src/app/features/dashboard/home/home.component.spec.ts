import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { signal } from '@angular/core';
import { HomeComponent } from './home.component';
import { AuthService } from '../../../core/services/auth.service';
import { CasesService } from '../../cases/shared/services/cases.service';
import { CaseStatus, PatientSpecies, AgeUnit } from '@vet-ai/shared-types';

function makeCase(id: string, status: CaseStatus) {
  return {
    id,
    tenantId: 't1',
    status,
    patientName: 'Pet',
    patientSpecies: PatientSpecies.DOG,
    patientAge: 3,
    patientAgeUnit: AgeUnit.YEARS,
    ownerName: 'Owner',
    createdByUserId: 'u1',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const MOCK_CASES = [
  makeCase('c1', CaseStatus.OPEN),
  makeCase('c2', CaseStatus.OPEN),
  makeCase('c3', CaseStatus.TRIAGED),
  makeCase('c4', CaseStatus.TRIAGED),
  makeCase('c5', CaseStatus.TRIAGED),
  makeCase('c6', CaseStatus.ORDERED),
  makeCase('c7', CaseStatus.COMPLETED),
  makeCase('c8', CaseStatus.CANCELLED),
];

describe('HomeComponent', () => {
  let casesServiceSpy: { listCases: ReturnType<typeof vi.fn> };
  let authServiceSpy: { me: ReturnType<typeof signal> };

  beforeEach(async () => {
    casesServiceSpy = { listCases: vi.fn().mockReturnValue(of(MOCK_CASES)) };
    authServiceSpy = {
      me: signal({
        user: { firstName: 'Karina', email: 'k@test.com' },
        tenants: [],
        memberships: [],
        activeTenantId: null,
        onboardingCompleted: true,
      }),
    };

    await TestBed.configureTestingModule({
      imports: [HomeComponent],
      providers: [
        provideTranslateService({ defaultLanguage: 'en' }),
        { provide: CasesService, useValue: casesServiceSpy },
        { provide: AuthService, useValue: authServiceSpy },
      ],
    }).compileComponents();
  });

  it('creates without error', () => {
    const fixture = TestBed.createComponent(HomeComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('greeting uses firstName when available', () => {
    const fixture = TestBed.createComponent(HomeComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.greeting()).toBe('Karina');
  });

  it('greeting falls back to email when firstName is null', () => {
    authServiceSpy.me.set({
      user: { firstName: null, email: 'k@test.com' },
      tenants: [],
      memberships: [],
      activeTenantId: null,
      onboardingCompleted: true,
    });
    const fixture = TestBed.createComponent(HomeComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.greeting()).toBe('k@test.com');
  });

  it('metrics[0] (Open Cases) counts only OPEN status', () => {
    const fixture = TestBed.createComponent(HomeComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.metrics()[0].value).toBe(2);
  });

  it('metrics[1] (Needs Attention) counts only TRIAGED status', () => {
    const fixture = TestBed.createComponent(HomeComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.metrics()[1].value).toBe(3);
  });

  it('metrics[2] (Results Pending) counts only ORDERED status', () => {
    const fixture = TestBed.createComponent(HomeComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.metrics()[2].value).toBe(1);
  });

  it('metrics[3] (Completed) counts only COMPLETED status', () => {
    const fixture = TestBed.createComponent(HomeComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.metrics()[3].value).toBe(1);
  });

  it('CANCELLED cases do not appear in any metric', () => {
    const fixture = TestBed.createComponent(HomeComponent);
    fixture.detectChanges();
    const total = fixture.componentInstance
      .metrics()
      .reduce((sum, m) => sum + m.value, 0);
    // 8 cases total, 1 is CANCELLED — sum of metrics should be 7
    expect(total).toBe(7);
  });
});
