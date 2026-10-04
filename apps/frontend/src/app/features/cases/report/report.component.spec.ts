import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { of, throwError } from 'rxjs';
import { TranslateModule } from '@ngx-translate/core';
import { ReportComponent } from './report.component';
import { CasesService } from '../shared/services/cases.service';
import { AuthService } from '../../../core/services/auth.service';
import { LanguageService } from '../../../core/services/language.service';
import {
  CaseStatus,
  PatientSpecies,
  AgeUnit,
  ClinicReleasedResultsModel,
  ClinicOrderReleasesModel,
} from '@vet-ai/shared-types';

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

const mockReleased: ClinicReleasedResultsModel = {
  reportId: 'report-001',
  orderId: 'ORD-0002',
  caseId: 'c4',
  releaseStatus: 'ALL_RELEASED',
  releasedTests: [],
  pendingTestNames: [],
  latestReleasedAt: '2026-03-29T00:00:00.000Z',
};

const mockReleases: ClinicOrderReleasesModel = {
  requisitionNumber: 'REQ-2026-000002',
  releases: [
    {
      id: 'rel-1',
      releaseSequence: 1,
      releaseType: 'PARTIAL',
      signerName: 'Dr. Lab',
      releasedAt: '2026-03-28T10:00:00.000Z',
      pdfStatus: 'COMPLETED',
      testNames: ['Hemograma'],
    },
    {
      id: 'rel-2',
      releaseSequence: 2,
      releaseType: 'FINAL',
      signerName: 'Dr. Lab',
      releasedAt: '2026-03-29T10:00:00.000Z',
      pdfStatus: 'COMPLETED',
      testNames: ['Química sanguínea'],
    },
  ],
};

describe('ReportComponent', () => {
  let fixture: ComponentFixture<ReportComponent>;
  let component: ReportComponent;
  let downloadReleasePdf: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    downloadReleasePdf = vi.fn(() => of(undefined));
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
            getReleasedResults: () => of(mockReleased),
            getExistingInterpretation: () => of(null),
            getOrderReleases: () => of(mockReleases),
            downloadReleasePdf,
          },
        },
        {
          provide: AuthService,
          useValue: {
            me: () => ({ tenants: [{ name: 'Test Clinic', logoUrl: null }] }),
          },
        },
        {
          provide: LanguageService,
          useValue: { currentLang: () => 'en' },
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

  it('loads case and released results on init', () => {
    expect(component.case()).toEqual(mockCase);
    expect(component.released()).toEqual(mockReleased);
    expect(component.loading()).toBe(false);
  });

  it('groups analytes into sections by test', () => {
    expect(component.sections()).toEqual([]);
  });

  it('formatValue returns empty for header rows', () => {
    const header = {
      isHeader: true,
      valueType: 'TEXT' as const,
      sortOrder: 0,
      id: 'h',
      reportId: 'r',
      reportTestId: 'rt',
      code: 'H',
      name: 'H',
    };
    expect(component.formatValue(header)).toBe('');
  });

  it('canInterpret is true for ALL_RELEASED', () => {
    expect(component.canInterpret()).toBe(true);
  });

  it('isPartial is false for ALL_RELEASED', () => {
    expect(component.isPartial()).toBe(false);
  });

  it('loads release history with requisition number', () => {
    expect(component.releases()).toEqual(mockReleases.releases);
    expect(component.requisitionNumber()).toBe('REQ-2026-000002');
  });

  it('lists releases newest first for the dropdown', () => {
    expect(
      component.releasesNewestFirst().map((r) => r.releaseSequence)
    ).toEqual([2, 1]);
  });

  it('downloadPdf requests the selected release with a requisition-based filename', () => {
    component.pdfMenuOpen.set(true);
    component.downloadPdf(mockReleases.releases[0]);
    expect(downloadReleasePdf).toHaveBeenCalledWith(
      'ORD-0002',
      1,
      'REQ-2026-000002-release-1.pdf'
    );
    expect(component.pdfMenuOpen()).toBe(false);
    expect(component.downloadingReleaseId()).toBeNull();
  });

  it('downloadPdf shows an error when the download fails', () => {
    downloadReleasePdf.mockReturnValueOnce(throwError(() => new Error('404')));
    component.downloadPdf(mockReleases.releases[1]);
    expect(component.pdfDownloadError()).toBe(true);
    expect(component.downloadingReleaseId()).toBeNull();
  });

  it('flags releasesLoadError when release history fails to load', () => {
    const service = TestBed.inject(CasesService) as unknown as {
      getOrderReleases: () => unknown;
    };
    service.getOrderReleases = () => throwError(() => new Error('404'));
    component.ngOnInit();
    expect(component.releasesLoadError()).toBe(true);
  });
});
