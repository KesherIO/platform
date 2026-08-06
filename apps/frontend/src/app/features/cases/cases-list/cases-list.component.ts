import {
  Component,
  inject,
  signal,
  computed,
  OnInit,
  HostListener,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { take } from 'rxjs';
import { CaseModel, CaseStatus, PatientSpecies } from '@vet-ai/shared-types';
import { CasesService } from '../shared/services/cases.service';
import { CaseCardComponent } from './components/case-card/case-card.component';
import {
  CasesFilterBarComponent,
  SortOption,
} from './components/cases-filter-bar/cases-filter-bar.component';

@Component({
  selector: 'app-cases-list',
  standalone: true,
  imports: [
    RouterLink,
    TranslatePipe,
    CaseCardComponent,
    CasesFilterBarComponent,
  ],
  templateUrl: './cases-list.component.html',
  styleUrl: './cases-list.component.scss',
})
export class CasesListComponent implements OnInit {
  private casesService = inject(CasesService);

  @HostListener('document:click')
  onDocumentClick(): void {
    this.openMenuId.set(null);
  }

  loading = signal(true);
  error = signal<string | null>(null);
  allCases = signal<CaseModel[]>([]);
  openMenuId = signal<string | null>(null);

  search = signal('');
  statusFilter = signal<CaseStatus | null>(null);
  speciesFilter = signal<PatientSpecies | null>(null);
  sort = signal<SortOption>('date-desc');

  filteredCases = computed(() => {
    let list = this.allCases();
    const q = this.search().toLowerCase().trim();
    if (q) {
      list = list.filter(
        (c) =>
          c.patientName.toLowerCase().includes(q) ||
          c.ownerName.toLowerCase().includes(q) ||
          c.id.toLowerCase().includes(q)
      );
    }
    if (this.statusFilter()) {
      list = list.filter((c) => c.status === this.statusFilter());
    }
    if (this.speciesFilter()) {
      list = list.filter((c) => c.patientSpecies === this.speciesFilter());
    }
    const sortVal = this.sort();
    return [...list].sort((a, b) => {
      if (sortVal === 'date-desc')
        return (
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      if (sortVal === 'date-asc')
        return (
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
      if (sortVal === 'name-asc')
        return a.patientName.localeCompare(b.patientName);
      return 0;
    });
  });

  ngOnInit(): void {
    this.casesService
      .listCases()
      .pipe(take(1))
      .subscribe({
        next: (cases) => {
          this.allCases.set(cases);
          this.loading.set(false);
        },
        error: () => {
          this.error.set('error');
          this.loading.set(false);
        },
      });
  }

  routeForCase(c: CaseModel): string[] {
    switch (c.status) {
      case CaseStatus.OPEN:
        return ['/cases', c.id, 'symptoms'];
      case CaseStatus.TRIAGED:
        return ['/cases', c.id, 'ai-results'];
      default:
        return ['/cases', c.id, 'order'];
    }
  }

  onCaseDeleted(id: string): void {
    this.casesService
      .deleteCase(id)
      .pipe(take(1))
      .subscribe(() => {
        this.allCases.update((cases) => cases.filter((c) => c.id !== id));
      });
  }
}
