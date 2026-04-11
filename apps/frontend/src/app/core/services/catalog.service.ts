import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, tap } from 'rxjs';
import { CatalogItemModel } from '@vet-ai/shared-types';

export const MOCK_CATALOG_ITEMS: CatalogItemModel[] = [
  // Tests
  {
    id: 't1',
    kind: 'TEST',
    code: 'CBC',
    name: 'Complete Blood Count',
    category: 'Hematology',
    turnaroundHours: 4,
    active: true,
  },
  {
    id: 't2',
    kind: 'TEST',
    code: 'BMP',
    name: 'Basic Metabolic Panel',
    category: 'Chemistry',
    turnaroundHours: 6,
    active: true,
  },
  {
    id: 't3',
    kind: 'TEST',
    code: 'UA',
    name: 'Urinalysis',
    category: 'Urinalysis',
    turnaroundHours: 4,
    active: true,
  },
  {
    id: 't4',
    kind: 'TEST',
    code: 'LFT',
    name: 'Liver Function Tests',
    category: 'Chemistry',
    turnaroundHours: 8,
    active: true,
  },
  {
    id: 't5',
    kind: 'TEST',
    code: 'TSH',
    name: 'Thyroid Stimulating Hormone',
    category: 'Endocrinology',
    turnaroundHours: 24,
    active: true,
  },
  {
    id: 't6',
    kind: 'TEST',
    code: 'LIPA',
    name: 'Lipase',
    category: 'Chemistry',
    turnaroundHours: 6,
    active: true,
  },
  {
    id: 't7',
    kind: 'TEST',
    code: 'CULT',
    name: 'Urine Culture',
    category: 'Microbiology',
    turnaroundHours: 72,
    active: true,
  },
  // Packages
  {
    id: 'p1',
    kind: 'PACKAGE',
    name: 'Wellness Panel',
    description: 'Comprehensive annual wellness screening',
    active: true,
    components: [
      {
        id: 't1',
        kind: 'TEST',
        code: 'CBC',
        name: 'Complete Blood Count',
        category: 'Hematology',
        turnaroundHours: 4,
        active: true,
      },
      {
        id: 't2',
        kind: 'TEST',
        code: 'BMP',
        name: 'Basic Metabolic Panel',
        category: 'Chemistry',
        turnaroundHours: 6,
        active: true,
      },
      {
        id: 't3',
        kind: 'TEST',
        code: 'UA',
        name: 'Urinalysis',
        category: 'Urinalysis',
        turnaroundHours: 4,
        active: true,
      },
    ],
  },
  {
    id: 'p2',
    kind: 'PACKAGE',
    name: 'Senior Panel',
    description: 'Extended panel for senior patients (7+ years)',
    active: true,
    components: [
      {
        id: 't1',
        kind: 'TEST',
        code: 'CBC',
        name: 'Complete Blood Count',
        category: 'Hematology',
        turnaroundHours: 4,
        active: true,
      },
      {
        id: 't2',
        kind: 'TEST',
        code: 'BMP',
        name: 'Basic Metabolic Panel',
        category: 'Chemistry',
        turnaroundHours: 6,
        active: true,
      },
      {
        id: 't3',
        kind: 'TEST',
        code: 'UA',
        name: 'Urinalysis',
        category: 'Urinalysis',
        turnaroundHours: 4,
        active: true,
      },
      {
        id: 't4',
        kind: 'TEST',
        code: 'LFT',
        name: 'Liver Function Tests',
        category: 'Chemistry',
        turnaroundHours: 8,
        active: true,
      },
      {
        id: 't5',
        kind: 'TEST',
        code: 'TSH',
        name: 'Thyroid Stimulating Hormone',
        category: 'Endocrinology',
        turnaroundHours: 24,
        active: true,
      },
    ],
  },
  {
    id: 'p3',
    kind: 'PACKAGE',
    name: 'GI Panel',
    description: 'Gastrointestinal workup panel',
    active: true,
    components: [
      {
        id: 't1',
        kind: 'TEST',
        code: 'CBC',
        name: 'Complete Blood Count',
        category: 'Hematology',
        turnaroundHours: 4,
        active: true,
      },
      {
        id: 't2',
        kind: 'TEST',
        code: 'BMP',
        name: 'Basic Metabolic Panel',
        category: 'Chemistry',
        turnaroundHours: 6,
        active: true,
      },
      {
        id: 't6',
        kind: 'TEST',
        code: 'LIPA',
        name: 'Lipase',
        category: 'Chemistry',
        turnaroundHours: 6,
        active: true,
      },
    ],
  },
];

@Injectable({ providedIn: 'root' })
export class CatalogService {
  private readonly http = inject(HttpClient);

  catalog = signal<CatalogItemModel[] | null>(null);

  loadCatalog(): Observable<CatalogItemModel[]> {
    if (this.catalog()) return of(this.catalog()!);
    return this.http
      .get<CatalogItemModel[]>('/api/catalog')
      .pipe(tap((items) => this.catalog.set(items)));
  }
}
