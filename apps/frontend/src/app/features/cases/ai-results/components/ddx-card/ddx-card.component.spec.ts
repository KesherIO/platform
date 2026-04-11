import { TestBed } from '@angular/core/testing';
import { DdxCardComponent } from './ddx-card.component';
import { provideTranslateService } from '@ngx-translate/core';

const MOCK_DIAGNOSIS = {
  name: 'Gastroenteritis',
  confidence: 82,
  explanation: 'Vomiting and lethargy are consistent with GI upset.',
};

describe('DdxCardComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DdxCardComponent],
      providers: [provideTranslateService({ defaultLanguage: 'en' })],
    }).compileComponents();
  });

  it('creates without error', () => {
    const fixture = TestBed.createComponent(DdxCardComponent);
    fixture.componentRef.setInput('diagnosis', MOCK_DIAGNOSIS);
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('starts collapsed', () => {
    const fixture = TestBed.createComponent(DdxCardComponent);
    fixture.componentRef.setInput('diagnosis', MOCK_DIAGNOSIS);
    fixture.detectChanges();
    expect(fixture.componentInstance.expanded()).toBe(false);
  });

  it('toggle() expands and collapses', () => {
    const fixture = TestBed.createComponent(DdxCardComponent);
    fixture.componentRef.setInput('diagnosis', MOCK_DIAGNOSIS);
    fixture.detectChanges();
    fixture.componentInstance.toggle();
    expect(fixture.componentInstance.expanded()).toBe(true);
    fixture.componentInstance.toggle();
    expect(fixture.componentInstance.expanded()).toBe(false);
  });
});
