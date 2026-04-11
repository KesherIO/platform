import { TestBed } from '@angular/core/testing';
import { TestPackageItemComponent } from './test-package-item.component';
import { CatalogItemModel } from '@vet-ai/shared-types';

const MOCK_PACKAGE: CatalogItemModel = {
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
      active: true,
    },
    {
      id: 't2',
      kind: 'TEST',
      code: 'BMP',
      name: 'Basic Metabolic Panel',
      active: true,
    },
  ],
};

describe('TestPackageItemComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestPackageItemComponent],
    }).compileComponents();
  });

  it('creates without error', () => {
    const fixture = TestBed.createComponent(TestPackageItemComponent);
    fixture.componentRef.setInput('item', MOCK_PACKAGE);
    fixture.componentRef.setInput('selected', false);
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('emits toggled when selection button clicked', () => {
    const fixture = TestBed.createComponent(TestPackageItemComponent);
    fixture.componentRef.setInput('item', MOCK_PACKAGE);
    fixture.componentRef.setInput('selected', false);
    fixture.detectChanges();
    const toggleSpy = vi.fn();
    fixture.componentInstance.toggled.subscribe(toggleSpy);
    fixture.nativeElement.querySelector('button').click();
    expect(toggleSpy).toHaveBeenCalled();
  });

  it('starts collapsed and expands on chevron click', () => {
    const fixture = TestBed.createComponent(TestPackageItemComponent);
    fixture.componentRef.setInput('item', MOCK_PACKAGE);
    fixture.componentRef.setInput('selected', false);
    fixture.detectChanges();
    expect(fixture.componentInstance.expanded()).toBe(false);
    const buttons = fixture.nativeElement.querySelectorAll('button');
    buttons[1].click(); // chevron button
    fixture.detectChanges();
    expect(fixture.componentInstance.expanded()).toBe(true);
    const items = fixture.nativeElement.querySelectorAll('li');
    expect(items).toHaveLength(2);
  });

  it('does not show chevron when package has no components', () => {
    const fixture = TestBed.createComponent(TestPackageItemComponent);
    fixture.componentRef.setInput('item', { ...MOCK_PACKAGE, components: [] });
    fixture.componentRef.setInput('selected', false);
    fixture.detectChanges();
    const buttons = fixture.nativeElement.querySelectorAll('button');
    expect(buttons).toHaveLength(1);
  });
});
