import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { TranslateModule } from '@ngx-translate/core';
import { ResultsComponent } from './results.component';
import { CasesService } from '../cases/shared/services/cases.service';
import { AuthService } from '../../core/services/auth.service';
import { CaseStatus, PatientSpecies, AgeUnit } from '@vet-ai/shared-types';

const mockCases = [
  {
    id: 'c4',
    tenantId: 'tenant1',
    status: CaseStatus.COMPLETED,
    patientName: 'Zeus',
    patientSpecies: PatientSpecies.DOG,
    patientAge: 4,
    patientAgeUnit: AgeUnit.YEARS,
    ownerName: 'Roberto',
    order: { orderId: 'ORD-0002', status: 'COMPLETED' },
    createdByUserId: 'u1',
    createdAt: new Date('2026-03-27'),
    updatedAt: new Date('2026-03-29'),
  },
  {
    id: 'c1',
    tenantId: 'tenant1',
    status: CaseStatus.OPEN,
    patientName: 'Max',
    patientSpecies: PatientSpecies.DOG,
    patientAge: 3,
    patientAgeUnit: AgeUnit.YEARS,
    ownerName: 'Carlos',
    createdByUserId: 'u1',
    createdAt: new Date('2026-04-07'),
    updatedAt: new Date('2026-04-07'),
  },
];

describe('ResultsComponent', () => {
  let fixture: ComponentFixture<ResultsComponent>;
  let component: ResultsComponent;
  let router: Router;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        ResultsComponent,
        TranslateModule.forRoot(),
        RouterTestingModule,
      ],
      providers: [
        {
          provide: CasesService,
          useValue: { listCases: () => of(mockCases) },
        },
        {
          provide: AuthService,
          useValue: { me: () => ({ tenants: [{ name: 'Test Clinic' }] }) },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ResultsComponent);
    component = fixture.componentInstance;
    router = TestBed.inject(Router);
    fixture.detectChanges();
  });

  it('creates without error', () => {
    expect(component).toBeTruthy();
  });

  it('filters to only COMPLETED cases', () => {
    expect(component.completedCases().length).toBe(1);
    expect(component.completedCases()[0].id).toBe('c4');
  });

  it('viewReport navigates to /cases/:id/report', () => {
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    component.viewReport(mockCases[0] as never);
    expect(navigateSpy).toHaveBeenCalledWith(['/cases', 'c4', 'report']);
  });
});
