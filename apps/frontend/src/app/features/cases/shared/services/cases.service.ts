import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, delay, tap, map, catchError, take } from 'rxjs';
import {
  CaseModel,
  CaseStatus,
  PatientSpecies,
  PatientSex,
  AgeUnit,
  ResultReportModel,
  AiInterpretationModel,
} from '@vet-ai/shared-types';
import { AuthService } from '../../../../core/services/auth.service';
import { MOCK_DELAY, MOCK_REPORT, mockCases } from './cases.mocks';

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
      catchError(() => of([] as CaseModel[])),
      map((cases) => (cases.length === 0 ? mockCases : cases)),
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
      .pipe(
        catchError(() => {
          const found = mockCases.find((c) => c.id === id);
          if (found) return of(found).pipe(delay(MOCK_DELAY));
          return of(mockCases[0]).pipe(delay(MOCK_DELAY));
        }),
        tap((c) => this.activeCase.set(c))
      );
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
    return this.http
      .post<CaseModel>(`/api/cases/${id}/triage`, {}, this.tenantHeaders)
      .pipe(tap((c) => this.activeCase.set(c)));
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
    return this.http.delete<void>(`/api/cases/${id}`, this.tenantHeaders).pipe(
      take(1),
      tap(() => {
        if (this.activeCase()?.id === id) this.activeCase.set(null);
      })
    );
  }

  getReportByOrderId(orderId: string): Observable<ResultReportModel> {
    if (orderId === 'ORD-0002') {
      return of(MOCK_REPORT).pipe(delay(MOCK_DELAY));
    }
    return this.http.get<ResultReportModel>(
      `/api/results/by-order/${orderId}`,
      this.tenantHeaders
    );
  }

  getExistingInterpretation(
    reportId: string,
    lang: 'en' | 'es'
  ): Observable<AiInterpretationModel | null> {
    return this.http
      .get<AiInterpretationModel | null>(
        `/api/results/reports/${reportId}/interpret?lang=${lang}`,
        this.tenantHeaders
      )
      .pipe(catchError(() => of(null)));
  }

  interpretReport(
    reportId: string,
    lang: 'en' | 'es'
  ): Observable<AiInterpretationModel> {
    return this.http.post<AiInterpretationModel>(
      `/api/results/reports/${reportId}/interpret`,
      { lang },
      this.tenantHeaders
    );
  }
}
