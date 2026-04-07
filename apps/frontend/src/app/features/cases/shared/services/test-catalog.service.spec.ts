import { TestBed } from '@angular/core/testing';
import { TestCatalogService } from './test-catalog.service';
import { firstValueFrom } from 'rxjs';

describe('TestCatalogService', () => {
  let service: TestCatalogService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(TestCatalogService);
  });

  it('should create', () => {
    expect(service).toBeTruthy();
  });

  it('catalog signal starts as null', () => {
    expect(service.catalog()).toBeNull();
  });

  it('loadCatalog returns tests and packages', async () => {
    const catalog = await firstValueFrom(service.loadCatalog());
    expect(catalog.tests.length).toBeGreaterThan(0);
    expect(catalog.packages.length).toBeGreaterThan(0);
  });

  it('loadCatalog sets catalog signal', async () => {
    const catalog = await firstValueFrom(service.loadCatalog());
    expect(service.catalog()).toEqual(catalog);
  });

  it('loadCatalog returns cached result on second call', async () => {
    await firstValueFrom(service.loadCatalog());
    const catalog = await firstValueFrom(service.loadCatalog());
    expect(catalog).toBeTruthy();
  });
});
