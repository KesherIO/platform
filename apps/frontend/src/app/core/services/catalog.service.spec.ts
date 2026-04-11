import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { CatalogService, MOCK_CATALOG_ITEMS } from './catalog.service';
import { AuthService } from './auth.service';
import { signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

describe('CatalogService', () => {
  let service: CatalogService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { me: signal(null) } },
      ],
    });
    service = TestBed.inject(CatalogService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('creates without error', () => {
    expect(service).toBeTruthy();
  });

  it('catalog signal starts as null', () => {
    expect(service.catalog()).toBeNull();
  });

  it('loadCatalog returns flat CatalogItemModel[]', async () => {
    const promise = firstValueFrom(service.loadCatalog());
    httpMock.expectOne('/api/catalog').flush(MOCK_CATALOG_ITEMS);
    const items = await promise;
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]).toHaveProperty('kind');
  });

  it('loadCatalog sets catalog signal', async () => {
    const promise = firstValueFrom(service.loadCatalog());
    httpMock.expectOne('/api/catalog').flush(MOCK_CATALOG_ITEMS);
    const items = await promise;
    expect(service.catalog()).toEqual(items);
  });

  it('loadCatalog returns cached result on second call without HTTP request', async () => {
    const first = firstValueFrom(service.loadCatalog());
    httpMock.expectOne('/api/catalog').flush(MOCK_CATALOG_ITEMS);
    await first;

    // Second call should hit cache — no HTTP request should be pending
    const items = await firstValueFrom(service.loadCatalog());
    httpMock.expectNone('/api/catalog');
    expect(items).toBeTruthy();
  });

  it('contains both TEST and PACKAGE items', async () => {
    const promise = firstValueFrom(service.loadCatalog());
    httpMock.expectOne('/api/catalog').flush(MOCK_CATALOG_ITEMS);
    const items = await promise;
    expect(items.some((i) => i.kind === 'TEST')).toBe(true);
    expect(items.some((i) => i.kind === 'PACKAGE')).toBe(true);
  });

  it('packages have components array', async () => {
    const promise = firstValueFrom(service.loadCatalog());
    httpMock.expectOne('/api/catalog').flush(MOCK_CATALOG_ITEMS);
    const items = await promise;
    const pkg = items.find((i) => i.kind === 'PACKAGE');
    expect(pkg?.components).toBeDefined();
    expect((pkg?.components ?? []).length).toBeGreaterThan(0);
  });
});
