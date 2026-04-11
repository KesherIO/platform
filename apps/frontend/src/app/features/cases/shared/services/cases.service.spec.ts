import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { CasesService } from './cases.service';
import { AuthService } from '../../../../core/services/auth.service';
import { CaseStatus, PatientSpecies, AgeUnit } from '@vet-ai/shared-types';
import { firstValueFrom } from 'rxjs';
import { signal } from '@angular/core';

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

describe('CasesService', () => {
  let service: CasesService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { me: signal(null) } },
      ],
    });
    service = TestBed.inject(CasesService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('should create', () => {
    expect(service).toBeTruthy();
  });

  it('activeCase signal starts as null', () => {
    expect(service.activeCase()).toBeNull();
  });

  it('listCases returns an array', async () => {
    const promise = firstValueFrom(service.listCases());
    httpMock.expectOne('/api/cases').flush([MOCK_CASE]);
    const cases = await promise;
    expect(Array.isArray(cases)).toBe(true);
  });

  it('createCase sets activeCase and returns new case', async () => {
    const newCase = {
      ...MOCK_CASE,
      patientName: 'Buddy',
      status: CaseStatus.OPEN,
    };
    const promise = firstValueFrom(
      service.createCase({
        patientName: 'Buddy',
        patientSpecies: PatientSpecies.DOG,
        patientAge: 2,
        patientAgeUnit: AgeUnit.YEARS,
        ownerName: 'Jane Doe',
      })
    );
    httpMock.expectOne('/api/cases').flush(newCase);
    const c = await promise;
    expect(c.patientName).toBe('Buddy');
    expect(c.status).toBe(CaseStatus.OPEN);
    expect(service.activeCase()?.patientName).toBe('Buddy');
  });

  it('updateSymptoms updates the symptoms field', async () => {
    const updated = { ...MOCK_CASE, symptoms: 'Coughing for 3 days' };
    const promise = firstValueFrom(
      service.updateSymptoms('c1', 'Coughing for 3 days')
    );
    httpMock.expectOne('/api/cases/c1/symptoms').flush(updated);
    const result = await promise;
    expect(result.symptoms).toBe('Coughing for 3 days');
  });

  it('updateCatalogSelection sets selectedCatalogItems', async () => {
    const selected = [
      { id: 't1', kind: 'TEST' as const, name: 'CBC', active: true },
      { id: 't2', kind: 'TEST' as const, name: 'BMP', active: true },
    ];
    const updated = { ...MOCK_CASE, selectedCatalogItems: selected };
    const promise = firstValueFrom(
      service.updateCatalogSelection('c1', ['t1', 't2'])
    );
    httpMock.expectOne('/api/cases/c1/catalog-selection').flush(updated);
    const result = await promise;
    expect(result.selectedCatalogItems?.length).toBe(2);
    expect(
      result.selectedCatalogItems?.every((i) => ['t1', 't2'].includes(i.id))
    ).toBe(true);
  });

  it('cancelCase sets status to CANCELLED', async () => {
    const cancelled = { ...MOCK_CASE, status: CaseStatus.CANCELLED };
    const promise = firstValueFrom(service.cancelCase('c1'));
    httpMock.expectOne('/api/cases/c1/cancel').flush(cancelled);
    const result = await promise;
    expect(result.status).toBe(CaseStatus.CANCELLED);
  });
});
