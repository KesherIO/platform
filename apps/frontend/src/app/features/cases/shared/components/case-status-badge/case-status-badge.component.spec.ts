import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CaseStatusBadgeComponent } from './case-status-badge.component';
import { TranslateModule } from '@ngx-translate/core';
import { CaseStatus } from '@vet-ai/shared-types';

describe('CaseStatusBadgeComponent', () => {
  let fixture: ComponentFixture<CaseStatusBadgeComponent>;
  let component: CaseStatusBadgeComponent;

  const setup = async (status: CaseStatus) => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [CaseStatusBadgeComponent, TranslateModule.forRoot()],
    }).compileComponents();
    fixture = TestBed.createComponent(CaseStatusBadgeComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('status', status);
    fixture.detectChanges();
  };

  beforeEach(() => setup(CaseStatus.OPEN));

  // ── Creation ──────────────────────────────────────────────────────────────

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('renders a span element', () => {
    expect(fixture.nativeElement.querySelector('span')).toBeTruthy();
  });

  // ── color getter ──────────────────────────────────────────────────────────

  it('returns cyan color for OPEN', () => {
    expect(component.color).toBe('#29B8BE');
  });

  it('returns purple color for TRIAGED', async () => {
    await setup(CaseStatus.TRIAGED);
    expect(component.color).toBe('#A65AF4');
  });

  it('returns blue color for ORDERED', async () => {
    await setup(CaseStatus.ORDERED);
    expect(component.color).toBe('#38A8E0');
  });

  it('returns green color for COMPLETED', async () => {
    await setup(CaseStatus.COMPLETED);
    expect(component.color).toBe('#1ECC83');
  });

  it('returns gray color for CANCELLED', async () => {
    await setup(CaseStatus.CANCELLED);
    expect(component.color).toBe('#9CA3AF');
  });

  // ── inline styles ─────────────────────────────────────────────────────────

  it('applies color as inline border and text style', async () => {
    await setup(CaseStatus.OPEN);
    const span: HTMLElement = fixture.nativeElement.querySelector('span');
    expect(span.style.borderColor).toBeTruthy();
    expect(span.style.color).toBeTruthy();
  });

  it('updates inline styles when status changes', async () => {
    await setup(CaseStatus.OPEN);
    fixture.componentRef.setInput('status', CaseStatus.CANCELLED);
    fixture.detectChanges();
    expect(component.color).toBe('#9CA3AF');
  });

  // ── CaseStatusLabelPipe integration ───────────────────────────────────────

  it('renders the translation key for OPEN status via pipe', () => {
    // TranslateModule with no loader returns the key itself
    const span: HTMLElement = fixture.nativeElement.querySelector('span');
    expect(span.textContent?.trim()).toBe('CASES.STATUS.OPEN');
  });

  it('renders the translation key for COMPLETED status', async () => {
    await setup(CaseStatus.COMPLETED);
    const span: HTMLElement = fixture.nativeElement.querySelector('span');
    expect(span.textContent?.trim()).toBe('CASES.STATUS.COMPLETED');
  });
});
