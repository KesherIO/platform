import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CasesFilterBarComponent } from './cases-filter-bar.component';
import { TranslateModule } from '@ngx-translate/core';
import { CaseStatus, PatientSpecies } from '@vet-ai/shared-types';

describe('CasesFilterBarComponent', () => {
  let fixture: ComponentFixture<CasesFilterBarComponent>;
  let component: CasesFilterBarComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CasesFilterBarComponent, TranslateModule.forRoot()],
    }).compileComponents();
    fixture = TestBed.createComponent(CasesFilterBarComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  // ── Creation ──────────────────────────────────────────────────────────────

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // ── Initial state ─────────────────────────────────────────────────────────

  it('filterOpen starts as false', () => {
    expect(component.filterOpen()).toBe(false);
  });

  it('sortOpen starts as false', () => {
    expect(component.sortOpen()).toBe(false);
  });

  it('hasActiveFilter is false when no filters are set', () => {
    expect(component.hasActiveFilter()).toBe(false);
  });

  // ── toggleFilter ──────────────────────────────────────────────────────────

  it('toggleFilter opens the filter dropdown', () => {
    component.toggleFilter();
    expect(component.filterOpen()).toBe(true);
  });

  it('toggleFilter closes the filter dropdown when already open', () => {
    component.toggleFilter();
    component.toggleFilter();
    expect(component.filterOpen()).toBe(false);
  });

  it('toggleFilter closes the sort dropdown', () => {
    component.toggleSort();
    component.toggleFilter();
    expect(component.sortOpen()).toBe(false);
  });

  // ── toggleSort ────────────────────────────────────────────────────────────

  it('toggleSort opens the sort dropdown', () => {
    component.toggleSort();
    expect(component.sortOpen()).toBe(true);
  });

  it('toggleSort closes the filter dropdown', () => {
    component.toggleFilter();
    component.toggleSort();
    expect(component.filterOpen()).toBe(false);
    expect(component.sortOpen()).toBe(true);
  });

  // ── hasActiveFilter ───────────────────────────────────────────────────────

  it('hasActiveFilter is true when statusFilter is set', () => {
    fixture.componentRef.setInput('statusFilter', CaseStatus.OPEN);
    expect(component.hasActiveFilter()).toBe(true);
  });

  it('hasActiveFilter is true when speciesFilter is set', () => {
    fixture.componentRef.setInput('speciesFilter', PatientSpecies.DOG);
    expect(component.hasActiveFilter()).toBe(true);
  });

  it('hasActiveFilter is false when both filters are null', () => {
    fixture.componentRef.setInput('statusFilter', null);
    fixture.componentRef.setInput('speciesFilter', null);
    expect(component.hasActiveFilter()).toBe(false);
  });

  // ── selectStatus ──────────────────────────────────────────────────────────

  it('emits statusChange with the selected status', () => {
    const emitted: (CaseStatus | null)[] = [];
    component.statusChange.subscribe((v) => emitted.push(v));
    component.selectStatus(CaseStatus.TRIAGED);
    expect(emitted).toEqual([CaseStatus.TRIAGED]);
  });

  it('emits statusChange with null to clear status', () => {
    const emitted: (CaseStatus | null)[] = [];
    component.statusChange.subscribe((v) => emitted.push(v));
    component.selectStatus(null);
    expect(emitted).toEqual([null]);
  });

  // ── selectSpecies ─────────────────────────────────────────────────────────

  it('emits speciesChange with the selected species', () => {
    const emitted: (PatientSpecies | null)[] = [];
    component.speciesChange.subscribe((v) => emitted.push(v));
    component.selectSpecies(PatientSpecies.CAT);
    expect(emitted).toEqual([PatientSpecies.CAT]);
  });

  it('emits speciesChange with null to clear species', () => {
    const emitted: (PatientSpecies | null)[] = [];
    component.speciesChange.subscribe((v) => emitted.push(v));
    component.selectSpecies(null);
    expect(emitted).toEqual([null]);
  });

  // ── selectSort ────────────────────────────────────────────────────────────

  it('emits sortChange with the selected option', () => {
    const emitted: string[] = [];
    component.sortChange.subscribe((v) => emitted.push(v));
    component.selectSort('name-asc');
    expect(emitted).toEqual(['name-asc']);
  });

  it('closes sort dropdown after selecting a sort option', () => {
    component.toggleSort();
    component.selectSort('date-asc');
    expect(component.sortOpen()).toBe(false);
  });

  // ── clearFilters ──────────────────────────────────────────────────────────

  it('clearFilters emits null for both status and species', () => {
    const statusEmitted: (CaseStatus | null)[] = [];
    const speciesEmitted: (PatientSpecies | null)[] = [];
    component.statusChange.subscribe((v) => statusEmitted.push(v));
    component.speciesChange.subscribe((v) => speciesEmitted.push(v));
    component.clearFilters();
    expect(statusEmitted).toEqual([null]);
    expect(speciesEmitted).toEqual([null]);
  });

  it('clearFilters closes the filter dropdown', () => {
    component.toggleFilter();
    component.clearFilters();
    expect(component.filterOpen()).toBe(false);
  });

  // ── onSearch ──────────────────────────────────────────────────────────────

  it('onSearch emits the input value via searchChange', () => {
    const emitted: string[] = [];
    component.searchChange.subscribe((v) => emitted.push(v));
    const input = document.createElement('input');
    input.value = 'Max';
    component.onSearch({ target: input } as unknown as Event);
    expect(emitted).toEqual(['Max']);
  });

  it('onSearch emits empty string when input is cleared', () => {
    const emitted: string[] = [];
    component.searchChange.subscribe((v) => emitted.push(v));
    const input = document.createElement('input');
    input.value = '';
    component.onSearch({ target: input } as unknown as Event);
    expect(emitted).toEqual(['']);
  });
});
