import { Injectable, signal } from '@angular/core';
import { Observable, of, delay, tap } from 'rxjs';
import {
  TestCatalogModel,
  TestModel,
  TestPackageModel,
} from '@vet-ai/shared-types';

const MOCK_DELAY = 600;

const MOCK_TESTS: TestModel[] = [
  {
    id: 't1',
    code: 'CBC',
    name: 'Complete Blood Count',
    category: 'Hematology',
    turnaroundHours: 4,
  },
  {
    id: 't2',
    code: 'BMP',
    name: 'Basic Metabolic Panel',
    category: 'Chemistry',
    turnaroundHours: 6,
  },
  {
    id: 't3',
    code: 'UA',
    name: 'Urinalysis',
    category: 'Urinalysis',
    turnaroundHours: 4,
  },
  {
    id: 't4',
    code: 'LFT',
    name: 'Liver Function Tests',
    category: 'Chemistry',
    turnaroundHours: 8,
  },
  {
    id: 't5',
    code: 'TSH',
    name: 'Thyroid Stimulating Hormone',
    category: 'Endocrinology',
    turnaroundHours: 24,
  },
  {
    id: 't6',
    code: 'LIPA',
    name: 'Lipase',
    category: 'Chemistry',
    turnaroundHours: 6,
  },
  {
    id: 't7',
    code: 'CULT',
    name: 'Urine Culture',
    category: 'Microbiology',
    turnaroundHours: 72,
  },
];

const MOCK_PACKAGES: TestPackageModel[] = [
  {
    id: 'p1',
    name: 'Wellness Panel',
    description: 'Comprehensive annual wellness screening',
    tests: [MOCK_TESTS[0], MOCK_TESTS[1], MOCK_TESTS[2]],
  },
  {
    id: 'p2',
    name: 'Senior Panel',
    description: 'Extended panel for senior patients (7+ years)',
    tests: [
      MOCK_TESTS[0],
      MOCK_TESTS[1],
      MOCK_TESTS[2],
      MOCK_TESTS[3],
      MOCK_TESTS[4],
    ],
  },
  {
    id: 'p3',
    name: 'GI Panel',
    description: 'Gastrointestinal workup panel',
    tests: [MOCK_TESTS[0], MOCK_TESTS[1], MOCK_TESTS[5]],
  },
];

@Injectable({ providedIn: 'root' })
export class TestCatalogService {
  catalog = signal<TestCatalogModel | null>(null);

  loadCatalog(): Observable<TestCatalogModel> {
    if (this.catalog()) {
      return of(this.catalog()!);
    }
    const catalogData: TestCatalogModel = {
      tests: MOCK_TESTS,
      packages: MOCK_PACKAGES,
    };
    // TODO: Replace with actual API calls GET /tests and GET /test-packages
    return of(catalogData).pipe(
      delay(MOCK_DELAY),
      tap((c) => this.catalog.set(c))
    );
  }
}
