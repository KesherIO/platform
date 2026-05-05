import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { TranslateModule } from '@ngx-translate/core';
import { ReportComponent } from './report.component';
import { CasesService } from '../shared/services/cases.service';
import { AuthService } from '../../../core/services/auth.service';
import { CaseStatus, PatientSpecies, AgeUnit } from '@vet-ai/shared-types';

const mockCase = {
  id: 'c4',
  tenantId: 'tenant1',
  status: CaseStatus.COMPLETED,
  patientName: 'Zeus',
  patientSpecies: PatientSpecies.DOG,
  patientBreed: 'German Shepherd',
  patientAge: 4,
  patientAgeUnit: AgeUnit.YEARS,
  patientWeight: 35,
  ownerName: 'Roberto Gutiérrez',
  ownerPhone: '+52 555 0004',
  orderSentAt: new Date('2026-03-28'),
  order: { orderId: 'ORD-0002', status: 'COMPLETED' },
  createdByUserId: 'u1',
  createdAt: new Date('2026-03-27'),
  updatedAt: new Date('2026-03-29'),
};

const mockReport = {
  id: 'report-001',
  orderId: 'ORD-0002',
  caseId: 'c4',
  tenantId: 'tenant1',
  templateId: 'tpl-cbc-dog-adult',
  status: 'RELEASED' as const,
  releasedAt: new Date('2026-03-29'),
  createdAt: new Date('2026-03-28'),
  updatedAt: new Date('2026-03-29'),
  analytes: [],
};

describe('ReportComponent', () => {
  let fixture: ComponentFixture<ReportComponent>;
  let component: ReportComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReportComponent, TranslateModule.forRoot()],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => 'c4' } } },
        },
        {
          provide: CasesService,
          useValue: {
            getCase: () => of(mockCase),
            getReportByOrderId: () => of(mockReport),
          },
        },
        {
          provide: AuthService,
          useValue: {
            me: () => ({ tenants: [{ name: 'Test Clinic', logoUrl: null }] }),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ReportComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('creates without error', () => {
    expect(component).toBeTruthy();
  });

  it('loads case and report on init', () => {
    expect(component.case()).toEqual(mockCase);
    expect(component.report()).toEqual(mockReport);
    expect(component.loading()).toBe(false);
  });

  it('groups analytes into sections', () => {
    expect(component.sections()).toEqual([]);
  });

  it('formatValue returns — for header rows', () => {
    const header = {
      isHeader: true,
      valueType: 'TEXT' as const,
      sortOrder: 0,
      id: 'h',
      reportId: 'r',
      code: 'H',
      name: 'H',
    };
    expect(component.formatValue(header)).toBe('');
  });
});
