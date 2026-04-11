import { TestBed } from '@angular/core/testing';
import { SelectedTestsChipsComponent } from './selected-tests-chips.component';
import { provideTranslateService } from '@ngx-translate/core';
import { CatalogItemModel } from '@vet-ai/shared-types';

describe('SelectedTestsChipsComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SelectedTestsChipsComponent],
      providers: [provideTranslateService({ defaultLanguage: 'en' })],
    }).compileComponents();
  });

  it('creates without error', () => {
    const fixture = TestBed.createComponent(SelectedTestsChipsComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders a chip for each test', () => {
    const fixture = TestBed.createComponent(SelectedTestsChipsComponent);
    const items: CatalogItemModel[] = [
      {
        id: 't1',
        kind: 'TEST',
        code: 'CBC',
        name: 'Complete Blood Count',
        active: true,
      },
      {
        id: 't2',
        kind: 'TEST',
        code: 'BMP',
        name: 'Basic Metabolic Panel',
        active: true,
      },
    ];
    fixture.componentRef.setInput('items', items);
    fixture.detectChanges();
    const chips = fixture.nativeElement.querySelectorAll('span.px-3');
    expect(chips.length).toBe(2);
  });

  it('filters tests and packages via computed signals', () => {
    const fixture = TestBed.createComponent(SelectedTestsChipsComponent);
    const items: CatalogItemModel[] = [
      { id: 't1', kind: 'TEST', name: 'CBC', active: true },
      { id: 'p1', kind: 'PACKAGE', name: 'Wellness Panel', active: true },
    ];
    fixture.componentRef.setInput('items', items);
    fixture.detectChanges();
    const comp = fixture.componentInstance;
    expect(comp.tests().length).toBe(1);
    expect(comp.packages().length).toBe(1);
  });
});
