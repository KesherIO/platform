import { TestBed } from '@angular/core/testing';
import { CasesService } from './cases.service';
import { CaseStatus, PatientSpecies, AgeUnit } from '@vet-ai/shared-types';
import { firstValueFrom } from 'rxjs';

describe('CasesService', () => {
  let service: CasesService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(CasesService);
  });

  it('should create', () => {
    expect(service).toBeTruthy();
  });

  it('activeCase signal starts as null', () => {
    expect(service.activeCase()).toBeNull();
  });

  it('listCases returns an array', async () => {
    const cases = await firstValueFrom(service.listCases());
    expect(Array.isArray(cases)).toBe(true);
  });

  it('createCase sets activeCase and returns new case', async () => {
    const c = await firstValueFrom(
      service.createCase({
        patientName: 'Buddy',
        patientSpecies: PatientSpecies.DOG,
        patientAge: 2,
        patientAgeUnit: AgeUnit.YEARS,
        ownerName: 'Jane Doe',
      })
    );
    expect(c.patientName).toBe('Buddy');
    expect(c.status).toBe(CaseStatus.OPEN);
    expect(service.activeCase()?.patientName).toBe('Buddy');
  });

  it('updateSymptoms updates the symptoms field', async () => {
    const cases = await firstValueFrom(service.listCases());
    const updated = await firstValueFrom(
      service.updateSymptoms(cases[0].id, 'Coughing for 3 days')
    );
    expect(updated.symptoms).toBe('Coughing for 3 days');
  });

  it('updateTests sets selectedTests', async () => {
    const cases = await firstValueFrom(service.listCases());
    const updated = await firstValueFrom(
      service.updateTests(cases[0].id, ['t1', 't2'], [])
    );
    expect(updated.selectedTests?.tests.length).toBe(2);
    expect(updated.selectedTests?.packages.length).toBe(0);
  });

  it('cancelCase sets status to CANCELLED', async () => {
    const cases = await firstValueFrom(service.listCases());
    const updated = await firstValueFrom(service.cancelCase(cases[0].id));
    expect(updated.status).toBe(CaseStatus.CANCELLED);
  });
});
