import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, delay, tap, map } from 'rxjs';
import {
  CaseModel,
  CaseStatus,
  PatientSpecies,
  PatientSex,
  AgeUnit,
  TriageResultModel,
} from '@vet-ai/shared-types';
import { AuthService } from '../../../../core/services/auth.service';
import { MOCK_CATALOG_ITEMS } from '../../../../core/services/catalog.service';

const MOCK_DELAY = 600;

const MOCK_TRIAGE: TriageResultModel = {
  diagnoses: [
    {
      name: 'Gastroenteritis',
      confidence: 82,
      explanation: 'Vomiting and lethargy are consistent with GI upset.',
    },
    {
      name: 'Pancreatitis',
      confidence: 61,
      explanation:
        'Abdominal pain and vomiting may indicate pancreatic inflammation.',
    },
    {
      name: 'Hepatic Disease',
      confidence: 34,
      explanation: 'Lethargy and anorexia can be signs of liver involvement.',
    },
  ],
  suggestedCatalogItemIds: ['t1', 't2', 't3', 'p1'],
};

let mockCases: CaseModel[] = [
  // --- DOGS ---
  {
    id: 'c1',
    tenantId: 'tenant1',
    status: CaseStatus.OPEN,
    patientName: 'Max',
    patientSpecies: PatientSpecies.DOG,
    patientBreed: 'Labrador',
    patientAge: 3,
    patientAgeUnit: AgeUnit.YEARS,
    patientWeight: 28,
    ownerName: 'Carlos Ramírez',
    ownerPhone: '+52 555 0001',
    createdByUserId: 'u1',
    createdAt: new Date('2026-04-07'),
    updatedAt: new Date('2026-04-07'),
  },
  {
    id: 'c2',
    tenantId: 'tenant1',
    status: CaseStatus.TRIAGED,
    patientName: 'Rocky',
    patientSpecies: PatientSpecies.DOG,
    patientBreed: 'Bulldog',
    patientAge: 7,
    patientAgeUnit: AgeUnit.YEARS,
    patientWeight: 22,
    ownerName: 'Luis Mendoza',
    ownerPhone: '+52 555 0002',
    symptoms: 'Limping and decreased appetite',
    triageResult: MOCK_TRIAGE,
    suggestedCatalogItemIds: MOCK_TRIAGE.suggestedCatalogItemIds,
    createdByUserId: 'u1',
    createdAt: new Date('2026-04-06'),
    updatedAt: new Date('2026-04-06'),
  },
  {
    id: 'c3',
    tenantId: 'tenant1',
    status: CaseStatus.ORDERED,
    patientName: 'Buddy',
    patientSpecies: PatientSpecies.DOG,
    patientBreed: 'Golden Retriever',
    patientAge: 5,
    patientAgeUnit: AgeUnit.YEARS,
    patientWeight: 32,
    ownerName: 'Martina Flores',
    ownerPhone: '+52 555 0003',
    symptoms: 'Skin irritation and scratching',
    selectedCatalogItems: MOCK_CATALOG_ITEMS.filter((i) =>
      ['t1', 't2'].includes(i.id)
    ),
    orderSentAt: new Date('2026-04-05'),
    order: { orderId: 'ORD-0001', status: 'ORDERED' },
    createdByUserId: 'u1',
    createdAt: new Date('2026-04-05'),
    updatedAt: new Date('2026-04-05'),
  },
  {
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
    symptoms: 'Ear infection and head shaking',
    selectedCatalogItems: MOCK_CATALOG_ITEMS.filter((i) =>
      ['t1', 'p1'].includes(i.id)
    ),
    orderSentAt: new Date('2026-03-28'),
    order: { orderId: 'ORD-0002', status: 'COMPLETED' },
    createdByUserId: 'u1',
    createdAt: new Date('2026-03-27'),
    updatedAt: new Date('2026-03-29'),
  },
  {
    id: 'c5',
    tenantId: 'tenant1',
    status: CaseStatus.OPEN,
    patientName: 'Charlie',
    patientSpecies: PatientSpecies.DOG,
    patientBreed: 'Beagle',
    patientAge: 2,
    patientAgeUnit: AgeUnit.YEARS,
    patientWeight: 12,
    ownerName: 'Valeria Ríos',
    ownerPhone: '+52 555 0005',
    createdByUserId: 'u1',
    createdAt: new Date('2026-04-07'),
    updatedAt: new Date('2026-04-07'),
  },
  {
    id: 'c6',
    tenantId: 'tenant1',
    status: CaseStatus.OPEN,
    patientName: 'Toby',
    patientSpecies: PatientSpecies.DOG,
    patientBreed: 'Poodle',
    patientAge: 6,
    patientAgeUnit: AgeUnit.YEARS,
    patientWeight: 8,
    ownerName: 'Fernando Salinas',
    ownerPhone: '+52 555 0006',
    createdByUserId: 'u1',
    createdAt: new Date('2026-04-06'),
    updatedAt: new Date('2026-04-06'),
  },
  {
    id: 'c7',
    tenantId: 'tenant1',
    status: CaseStatus.CANCELLED,
    patientName: 'Duke',
    patientSpecies: PatientSpecies.DOG,
    patientBreed: 'Rottweiler',
    patientAge: 9,
    patientAgeUnit: AgeUnit.YEARS,
    patientWeight: 48,
    ownerName: 'Isabel Moreno',
    ownerPhone: '+52 555 0007',
    symptoms: 'Joint stiffness',
    createdByUserId: 'u1',
    createdAt: new Date('2026-04-01'),
    updatedAt: new Date('2026-04-02'),
  },
  {
    id: 'c8',
    tenantId: 'tenant1',
    status: CaseStatus.ORDERED,
    patientName: 'Coco',
    patientSpecies: PatientSpecies.DOG,
    patientBreed: 'Chihuahua',
    patientAge: 4,
    patientAgeUnit: AgeUnit.YEARS,
    patientWeight: 2.5,
    ownerName: 'Patricia Álvarez',
    ownerPhone: '+52 555 0008',
    symptoms: 'Trembling and low energy',
    selectedCatalogItems: MOCK_CATALOG_ITEMS.filter((i) =>
      ['t2', 't3'].includes(i.id)
    ),
    orderSentAt: new Date('2026-04-04'),
    order: { orderId: 'ORD-0003', status: 'ORDERED' },
    createdByUserId: 'u1',
    createdAt: new Date('2026-04-03'),
    updatedAt: new Date('2026-04-04'),
  },
  {
    id: 'c9',
    tenantId: 'tenant1',
    status: CaseStatus.TRIAGED,
    patientName: 'Milo',
    patientSpecies: PatientSpecies.DOG,
    patientBreed: 'Dachshund',
    patientAge: 5,
    patientAgeUnit: AgeUnit.YEARS,
    patientWeight: 9,
    ownerName: 'Andrés Castillo',
    ownerPhone: '+52 555 0009',
    symptoms: 'Back pain and reluctance to move',
    triageResult: MOCK_TRIAGE,
    suggestedCatalogItemIds: MOCK_TRIAGE.suggestedCatalogItemIds,
    createdByUserId: 'u1',
    createdAt: new Date('2026-04-05'),
    updatedAt: new Date('2026-04-05'),
  },
  {
    id: 'c10',
    tenantId: 'tenant1',
    status: CaseStatus.COMPLETED,
    patientName: 'Bear',
    patientSpecies: PatientSpecies.DOG,
    patientBreed: 'Husky',
    patientAge: 3,
    patientAgeUnit: AgeUnit.YEARS,
    patientWeight: 27,
    ownerName: 'Camila Vargas',
    ownerPhone: '+52 555 0010',
    symptoms: 'Eye discharge and redness',
    selectedCatalogItems: MOCK_CATALOG_ITEMS.filter((i) =>
      ['t1', 't4'].includes(i.id)
    ),
    orderSentAt: new Date('2026-03-15'),
    order: { orderId: 'ORD-0004', status: 'COMPLETED' },
    createdByUserId: 'u1',
    createdAt: new Date('2026-03-14'),
    updatedAt: new Date('2026-03-16'),
  },
  // --- CATS ---
  {
    id: 'c11',
    tenantId: 'tenant1',
    status: CaseStatus.TRIAGED,
    patientName: 'Luna',
    patientSpecies: PatientSpecies.CAT,
    patientBreed: 'Siamese',
    patientAge: 5,
    patientAgeUnit: AgeUnit.YEARS,
    patientWeight: 4,
    ownerName: 'Ana Torres',
    ownerPhone: '+52 555 0011',
    symptoms: 'Vomiting and lethargy for 2 days',
    triageResult: MOCK_TRIAGE,
    suggestedCatalogItemIds: MOCK_TRIAGE.suggestedCatalogItemIds,
    createdByUserId: 'u1',
    createdAt: new Date('2026-04-06'),
    updatedAt: new Date('2026-04-06'),
  },
  {
    id: 'c12',
    tenantId: 'tenant1',
    status: CaseStatus.OPEN,
    patientName: 'Nala',
    patientSpecies: PatientSpecies.CAT,
    patientBreed: 'Persian',
    patientAge: 3,
    patientAgeUnit: AgeUnit.YEARS,
    patientWeight: 3.5,
    ownerName: 'Gabriela Reyes',
    ownerPhone: '+52 555 0012',
    createdByUserId: 'u1',
    createdAt: new Date('2026-04-07'),
    updatedAt: new Date('2026-04-07'),
  },
  {
    id: 'c13',
    tenantId: 'tenant1',
    status: CaseStatus.ORDERED,
    patientName: 'Simba',
    patientSpecies: PatientSpecies.CAT,
    patientBreed: 'Maine Coon',
    patientAge: 6,
    patientAgeUnit: AgeUnit.YEARS,
    patientWeight: 6.5,
    ownerName: 'Eduardo Romero',
    ownerPhone: '+52 555 0013',
    symptoms: 'Urinary issues and frequent licking',
    selectedCatalogItems: MOCK_CATALOG_ITEMS.filter((i) =>
      ['t3', 't4'].includes(i.id)
    ),
    orderSentAt: new Date('2026-04-03'),
    order: { orderId: 'ORD-0005', status: 'ORDERED' },
    createdByUserId: 'u1',
    createdAt: new Date('2026-04-02'),
    updatedAt: new Date('2026-04-03'),
  },
  {
    id: 'c14',
    tenantId: 'tenant1',
    status: CaseStatus.COMPLETED,
    patientName: 'Mittens',
    patientSpecies: PatientSpecies.CAT,
    patientBreed: 'Ragdoll',
    patientAge: 8,
    patientAgeUnit: AgeUnit.YEARS,
    patientWeight: 5,
    ownerName: 'Lucía Peña',
    ownerPhone: '+52 555 0014',
    symptoms: 'Weight loss and increased thirst',
    selectedCatalogItems: MOCK_CATALOG_ITEMS.filter((i) =>
      ['t2', 't5'].includes(i.id)
    ),
    orderSentAt: new Date('2026-03-10'),
    order: { orderId: 'ORD-0006', status: 'COMPLETED' },
    createdByUserId: 'u1',
    createdAt: new Date('2022-03-09'),
    updatedAt: new Date('2022-03-11'),
  },
  {
    id: 'c15',
    tenantId: 'tenant1',
    status: CaseStatus.OPEN,
    patientName: 'Oliver',
    patientSpecies: PatientSpecies.CAT,
    patientBreed: 'British Shorthair',
    patientAge: 2,
    patientAgeUnit: AgeUnit.YEARS,
    patientWeight: 4.2,
    ownerName: 'Santiago Ibarra',
    ownerPhone: '+52 555 0015',
    createdByUserId: 'u1',
    createdAt: new Date('2026-04-07'),
    updatedAt: new Date('2026-04-07'),
  },
  {
    id: 'c16',
    tenantId: 'tenant1',
    status: CaseStatus.TRIAGED,
    patientName: 'Whiskers',
    patientSpecies: PatientSpecies.CAT,
    patientBreed: 'Bengal',
    patientAge: 4,
    patientAgeUnit: AgeUnit.YEARS,
    patientWeight: 5.5,
    ownerName: 'Daniela Ortega',
    ownerPhone: '+52 555 0016',
    symptoms: 'Sneezing and nasal discharge',
    triageResult: MOCK_TRIAGE,
    suggestedCatalogItemIds: MOCK_TRIAGE.suggestedCatalogItemIds,
    createdByUserId: 'u1',
    createdAt: new Date('2026-04-04'),
    updatedAt: new Date('2026-04-04'),
  },
  {
    id: 'c17',
    tenantId: 'tenant1',
    status: CaseStatus.OPEN,
    patientName: 'Shadow',
    patientSpecies: PatientSpecies.CAT,
    patientBreed: 'Domestic Shorthair',
    patientAge: 1,
    patientAgeUnit: AgeUnit.YEARS,
    patientWeight: 3.8,
    ownerName: 'Javier Núñez',
    ownerPhone: '+52 555 0017',
    createdByUserId: 'u1',
    createdAt: new Date('2026-04-06'),
    updatedAt: new Date('2026-04-06'),
  },
  // --- OTHER SPECIES ---
  {
    id: 'c18',
    tenantId: 'tenant1',
    status: CaseStatus.COMPLETED,
    patientName: 'Pegasus',
    patientSpecies: PatientSpecies.EQUINE,
    patientBreed: 'Thoroughbred',
    patientAge: 10,
    patientAgeUnit: AgeUnit.YEARS,
    patientWeight: 480,
    ownerName: 'Sofía Herrera',
    ownerPhone: '+52 555 0018',
    symptoms: 'Lameness in left foreleg',
    selectedCatalogItems: MOCK_CATALOG_ITEMS.filter((i) =>
      ['t1', 't4'].includes(i.id)
    ),
    orderSentAt: new Date('2026-03-20'),
    order: { orderId: 'ORD-0007', status: 'COMPLETED' },
    createdByUserId: 'u1',
    createdAt: new Date('2026-03-19'),
    updatedAt: new Date('2026-03-21'),
  },
  {
    id: 'c19',
    tenantId: 'tenant1',
    status: CaseStatus.OPEN,
    patientName: 'Bessie',
    patientSpecies: PatientSpecies.BOVINE,
    patientBreed: 'Holstein',
    patientAge: 4,
    patientAgeUnit: AgeUnit.YEARS,
    patientWeight: 550,
    ownerName: 'Jorge Vega',
    ownerPhone: '+52 555 0019',
    createdByUserId: 'u1',
    createdAt: new Date('2026-04-05'),
    updatedAt: new Date('2026-04-05'),
  },
  {
    id: 'c20',
    tenantId: 'tenant1',
    status: CaseStatus.TRIAGED,
    patientName: 'Kiwi',
    patientSpecies: PatientSpecies.BIRD,
    patientBreed: 'African Grey',
    patientAge: 8,
    patientAgeUnit: AgeUnit.MONTHS,
    patientWeight: 0.4,
    ownerName: 'Mariana López',
    ownerPhone: '+52 555 0020',
    symptoms: 'Feather plucking and reduced appetite',
    triageResult: MOCK_TRIAGE,
    suggestedCatalogItemIds: MOCK_TRIAGE.suggestedCatalogItemIds,
    createdByUserId: 'u1',
    createdAt: new Date('2026-04-06'),
    updatedAt: new Date('2026-04-06'),
  },
  {
    id: 'c21',
    tenantId: 'tenant1',
    status: CaseStatus.OPEN,
    patientName: 'Draco',
    patientSpecies: PatientSpecies.REPTILE,
    patientBreed: 'Bearded Dragon',
    patientAge: 2,
    patientAgeUnit: AgeUnit.YEARS,
    patientWeight: 0.45,
    ownerName: 'Diego Fuentes',
    ownerPhone: '+52 555 0021',
    createdByUserId: 'u1',
    createdAt: new Date('2026-04-06'),
    updatedAt: new Date('2026-04-06'),
  },
  {
    id: 'c22',
    tenantId: 'tenant1',
    status: CaseStatus.CANCELLED,
    patientName: 'Thumper',
    patientSpecies: PatientSpecies.RABBIT,
    patientBreed: 'Holland Lop',
    patientAge: 18,
    patientAgeUnit: AgeUnit.MONTHS,
    patientWeight: 1.8,
    ownerName: 'Valentina Cruz',
    ownerPhone: '+52 555 0022',
    symptoms: 'Head tilt and loss of balance',
    createdByUserId: 'u1',
    createdAt: new Date('2026-04-02'),
    updatedAt: new Date('2026-04-02'),
  },
  {
    id: 'c23',
    tenantId: 'tenant1',
    status: CaseStatus.OPEN,
    patientName: 'Nemo',
    patientSpecies: PatientSpecies.OTHER,
    patientBreed: 'Axolotl',
    patientAge: 1,
    patientAgeUnit: AgeUnit.YEARS,
    patientWeight: 0.1,
    ownerName: 'Renata Ibáñez',
    ownerPhone: '+52 555 0023',
    createdByUserId: 'u1',
    createdAt: new Date('2026-04-07'),
    updatedAt: new Date('2026-04-07'),
  },
];

@Injectable({ providedIn: 'root' })
export class CasesService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  private get tenantHeaders() {
    const me = this.auth.me();
    const tenantId = me?.activeTenantId ?? me?.tenants[0]?.id ?? '';
    return { headers: { 'x-tenant-id': tenantId } };
  }

  activeCase = signal<CaseModel | null>(null);

  listCases(params?: {
    search?: string;
    status?: CaseStatus;
    species?: PatientSpecies;
  }): Observable<CaseModel[]> {
    return this.http.get<CaseModel[]>('/api/cases', this.tenantHeaders).pipe(
      map((cases) => {
        let result = cases;
        if (params?.search) {
          const q = params.search.toLowerCase();
          result = result.filter(
            (c) =>
              c.patientName.toLowerCase().includes(q) ||
              c.ownerName.toLowerCase().includes(q)
          );
        }
        if (params?.status) {
          result = result.filter((c) => c.status === params.status);
        }
        if (params?.species) {
          result = result.filter((c) => c.patientSpecies === params.species);
        }
        return result;
      })
    );
  }

  getCase(id: string): Observable<CaseModel> {
    return this.http
      .get<CaseModel>(`/api/cases/${id}`, this.tenantHeaders)
      .pipe(tap((c) => this.activeCase.set(c)));
  }

  searchCases(query: string): Observable<CaseModel[]> {
    if (!query.trim()) return of([]);
    return this.http.get<CaseModel[]>('/api/cases', this.tenantHeaders).pipe(
      map((cases) => {
        const q = query.toLowerCase();
        return cases
          .filter(
            (c) =>
              c.patientName.toLowerCase().includes(q) ||
              c.ownerName.toLowerCase().includes(q)
          )
          .slice(0, 5);
      })
    );
  }

  createCase(data: {
    patientName: string;
    patientSpecies: PatientSpecies;
    patientSex?: PatientSex;
    patientBreed?: string;
    patientDateOfBirth?: string;
    patientAge?: number;
    patientAgeUnit?: AgeUnit;
    patientWeight?: number;
    ownerName: string;
    ownerPhone?: string;
  }): Observable<CaseModel> {
    return this.http
      .post<CaseModel>('/api/cases', data, this.tenantHeaders)
      .pipe(tap((c) => this.activeCase.set(c)));
  }

  updateCase(
    id: string,
    data: Partial<
      Pick<
        CaseModel,
        | 'patientName'
        | 'patientSpecies'
        | 'patientSex'
        | 'patientBreed'
        | 'patientDateOfBirth'
        | 'patientAge'
        | 'patientAgeUnit'
        | 'patientWeight'
        | 'ownerName'
        | 'ownerPhone'
      >
    >
  ): Observable<CaseModel> {
    return this.http
      .patch<CaseModel>(`/api/cases/${id}`, data, this.tenantHeaders)
      .pipe(tap((c) => this.activeCase.set(c)));
  }

  updateSymptoms(id: string, symptoms: string): Observable<CaseModel> {
    return this.http
      .patch<CaseModel>(
        `/api/cases/${id}/symptoms`,
        { symptoms },
        this.tenantHeaders
      )
      .pipe(tap((c) => this.activeCase.set(c)));
  }

  triggerTriage(id: string): Observable<CaseModel> {
    // TODO: Replace with actual API call POST /cases/:id/triage
    return of(
      this._applyUpdate(id, {
        status: CaseStatus.TRIAGED,
        triageResult: MOCK_TRIAGE,
        suggestedCatalogItemIds: MOCK_TRIAGE.suggestedCatalogItemIds,
      })
    ).pipe(delay(2000));
  }

  updateCatalogSelection(
    id: string,
    catalogItemIds: string[]
  ): Observable<CaseModel> {
    return this.http
      .patch<CaseModel>(
        `/api/cases/${id}/catalog-selection`,
        { selectedCatalogItemIds: catalogItemIds },
        this.tenantHeaders
      )
      .pipe(tap((c) => this.activeCase.set(c)));
  }

  createOrder(
    id: string
  ): Observable<{ orderId: string; requisitionUrl: string }> {
    return this.http
      .post<{ id: string; requisitionNumber: string; requisitionUrl: string }>(
        `/api/cases/${id}/order`,
        {},
        this.tenantHeaders
      )
      .pipe(
        map((order) => ({
          orderId: order.requisitionNumber,
          requisitionUrl: order.requisitionUrl,
        }))
      );
  }

  cancelCase(id: string): Observable<CaseModel> {
    return this.http
      .post<CaseModel>(`/api/cases/${id}/cancel`, {}, this.tenantHeaders)
      .pipe(tap((c) => this.activeCase.set(c)));
  }

  deleteCase(id: string): Observable<void> {
    mockCases = mockCases.filter((c) => c.id !== id);
    if (this.activeCase()?.id === id) this.activeCase.set(null);
    // TODO: Replace with actual API call DELETE /cases/:id
    return of(undefined).pipe(delay(MOCK_DELAY));
  }

  private _applyUpdate(id: string, patch: Partial<CaseModel>): CaseModel {
    const idx = mockCases.findIndex((c) => c.id === id);
    if (idx === -1) throw new Error(`Case ${id} not found`);
    const updated = { ...mockCases[idx], ...patch, updatedAt: new Date() };
    mockCases = mockCases.map((c) => (c.id === id ? updated : c));
    this.activeCase.set(updated);
    return updated;
  }
}
