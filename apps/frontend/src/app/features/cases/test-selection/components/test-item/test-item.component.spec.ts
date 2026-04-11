import { TestBed } from '@angular/core/testing';
import { TestItemComponent } from './test-item.component';
import { CatalogItemModel } from '@vet-ai/shared-types';

const MOCK_ITEM: CatalogItemModel = {
  id: 't1',
  kind: 'TEST',
  code: 'CBC',
  name: 'Complete Blood Count',
  category: 'Hematology',
  turnaroundHours: 4,
  active: true,
};

describe('TestItemComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestItemComponent],
    }).compileComponents();
  });

  it('creates without error', () => {
    const fixture = TestBed.createComponent(TestItemComponent);
    fixture.componentRef.setInput('item', MOCK_ITEM);
    fixture.componentRef.setInput('selected', false);
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('emits toggled when clicked', () => {
    const fixture = TestBed.createComponent(TestItemComponent);
    fixture.componentRef.setInput('item', MOCK_ITEM);
    fixture.componentRef.setInput('selected', false);
    fixture.detectChanges();
    const toggleSpy = vi.fn();
    fixture.componentInstance.toggled.subscribe(toggleSpy);
    fixture.nativeElement.querySelector('button').click();
    expect(toggleSpy).toHaveBeenCalled();
  });

  it('applies cyan indicator when selected', () => {
    const fixture = TestBed.createComponent(TestItemComponent);
    fixture.componentRef.setInput('item', MOCK_ITEM);
    fixture.componentRef.setInput('selected', true);
    fixture.detectChanges();
    const indicator = fixture.nativeElement.querySelector('span');
    expect(indicator.classList).toContain('bg-cyan');
  });
});
