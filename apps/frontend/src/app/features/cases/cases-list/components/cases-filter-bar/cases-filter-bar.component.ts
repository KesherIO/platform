import {
  Component,
  input,
  output,
  signal,
  computed,
  ElementRef,
  HostListener,
  inject,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { CaseStatus, PatientSpecies } from '@vet-ai/shared-types';
import { SortOption } from './sort-option.type';

export type { SortOption };

@Component({
  selector: 'app-cases-filter-bar',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './cases-filter-bar.component.html',
  styleUrl: './cases-filter-bar.component.scss',
})
export class CasesFilterBarComponent {
  private elRef = inject(ElementRef);

  search = input<string>('');
  statusFilter = input<CaseStatus | null>(null);
  speciesFilter = input<PatientSpecies | null>(null);
  sort = input<SortOption>('date-desc');
  resultCount = input<number>(0);

  searchChange = output<string>();
  statusChange = output<CaseStatus | null>();
  speciesChange = output<PatientSpecies | null>();
  sortChange = output<SortOption>();

  filterOpen = signal(false);
  sortOpen = signal(false);

  readonly statusColors: Record<CaseStatus, string> = {
    [CaseStatus.OPEN]: '#29B8BE',
    [CaseStatus.TRIAGED]: '#C46BE8',
    [CaseStatus.ORDERED]: '#38A8E0',
    [CaseStatus.COMPLETED]: '#1ECC83',
    [CaseStatus.CANCELLED]: '#9CA3AF',
  };

  readonly statuses: { value: CaseStatus; labelKey: string }[] = [
    { value: CaseStatus.OPEN, labelKey: 'CASES.STATUS.OPEN' },
    { value: CaseStatus.TRIAGED, labelKey: 'CASES.STATUS.TRIAGED' },
    { value: CaseStatus.ORDERED, labelKey: 'CASES.STATUS.ORDERED' },
    { value: CaseStatus.COMPLETED, labelKey: 'CASES.STATUS.COMPLETED' },
    { value: CaseStatus.CANCELLED, labelKey: 'CASES.STATUS.CANCELLED' },
  ];

  readonly species: { value: PatientSpecies; labelKey: string }[] = [
    { value: PatientSpecies.DOG, labelKey: 'CASES.NEW.SPECIES_DOG' },
    { value: PatientSpecies.CAT, labelKey: 'CASES.NEW.SPECIES_CAT' },
    { value: PatientSpecies.EQUINE, labelKey: 'CASES.NEW.SPECIES_EQUINE' },
    { value: PatientSpecies.BOVINE, labelKey: 'CASES.NEW.SPECIES_BOVINE' },
    { value: PatientSpecies.BIRD, labelKey: 'CASES.NEW.SPECIES_BIRD' },
    { value: PatientSpecies.REPTILE, labelKey: 'CASES.NEW.SPECIES_REPTILE' },
    { value: PatientSpecies.RABBIT, labelKey: 'CASES.NEW.SPECIES_RABBIT' },
    { value: PatientSpecies.OTHER, labelKey: 'CASES.NEW.SPECIES_OTHER' },
  ];

  readonly sortOptions: { value: SortOption; labelKey: string }[] = [
    { value: 'date-desc', labelKey: 'CASES.SORT.DATE_DESC' },
    { value: 'date-asc', labelKey: 'CASES.SORT.DATE_ASC' },
    { value: 'name-asc', labelKey: 'CASES.SORT.NAME_ASC' },
  ];

  hasActiveFilter = computed(
    () => this.statusFilter() !== null || this.speciesFilter() !== null
  );

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as Node;
    const el = this.elRef.nativeElement as HTMLElement;
    const filterDropdown = el.querySelector('.filter-dropdown');
    const sortDropdown = el.querySelector('.sort-dropdown');
    const filterBtn = el.querySelector('.filter-btn');
    const sortBtn = el.querySelector('.sort-btn');

    const insideFilterArea =
      filterBtn?.contains(target) || filterDropdown?.contains(target);
    const insideSortArea =
      sortBtn?.contains(target) || sortDropdown?.contains(target);

    if (!insideFilterArea) this.filterOpen.set(false);
    if (!insideSortArea) this.sortOpen.set(false);
  }

  onSearch(event: Event): void {
    this.searchChange.emit((event.target as HTMLInputElement).value);
  }

  toggleFilter(): void {
    this.filterOpen.update((v) => !v);
    this.sortOpen.set(false);
  }

  toggleSort(): void {
    this.sortOpen.update((v) => !v);
    this.filterOpen.set(false);
  }

  selectStatus(value: CaseStatus | null): void {
    this.statusChange.emit(value);
  }

  selectSpecies(value: PatientSpecies | null): void {
    this.speciesChange.emit(value);
  }

  selectSort(value: SortOption): void {
    this.sortChange.emit(value);
    this.sortOpen.set(false);
  }

  clearFilters(): void {
    this.statusChange.emit(null);
    this.speciesChange.emit(null);
    this.filterOpen.set(false);
  }
}
