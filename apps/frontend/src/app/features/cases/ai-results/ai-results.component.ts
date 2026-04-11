import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { forkJoin, take } from 'rxjs';
import { CaseModel, CatalogItemModel } from '@vet-ai/shared-types';
import { CasesService } from '../shared/services/cases.service';
import { CatalogService } from '../../../core/services/catalog.service';
import { CaseWizardLayoutComponent } from '../shared/components/case-wizard-layout/case-wizard-layout.component';
import { ButtonComponent } from '../../../shared/components';
import { DdxCardComponent } from './components/ddx-card/ddx-card.component';
import { TestItemComponent } from '../test-selection/components/test-item/test-item.component';
import { TestPackageItemComponent } from '../test-selection/components/test-package-item/test-package-item.component';

@Component({
  selector: 'app-ai-results',
  standalone: true,
  imports: [
    TranslatePipe,
    CaseWizardLayoutComponent,
    ButtonComponent,
    DdxCardComponent,
    TestItemComponent,
    TestPackageItemComponent,
  ],
  templateUrl: './ai-results.component.html',
  styleUrl: './ai-results.component.scss',
})
export class AiResultsComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private casesService = inject(CasesService);
  private catalogService = inject(CatalogService);

  loading = signal(true);
  saving = signal(false);
  case = signal<CaseModel | null>(null);
  catalog = signal<CatalogItemModel[]>([]);
  searchQuery = signal('');
  selectedItemIds = signal<Set<string>>(new Set());

  diagnoses = computed(() => this.case()?.triageResult?.diagnoses ?? []);

  filteredTests = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const tests = this.catalog().filter((i) => i.kind === 'TEST');
    return q ? tests.filter((t) => t.name.toLowerCase().includes(q)) : tests;
  });

  filteredPackages = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const packages = this.catalog().filter((i) => i.kind === 'PACKAGE');
    return q
      ? packages.filter((p) => p.name.toLowerCase().includes(q))
      : packages;
  });

  hasSelection = computed(() => this.selectedItemIds().size > 0);

  isSuggested(id: string): boolean {
    return (
      this.case()?.triageResult?.suggestedCatalogItemIds?.includes(id) ?? false
    );
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id')!;

    forkJoin({
      c: this.casesService.getCase(id),
      catalog: this.catalogService.loadCatalog(),
    }).subscribe({
      next: ({ c, catalog }) => {
        this.catalog.set(catalog);
        this.case.set(c);
        // Pre-select AI-suggested items — runs only after both are ready
        const suggestedIds = c.triageResult?.suggestedCatalogItemIds ?? [];
        this.selectedItemIds.set(new Set(suggestedIds));
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  toggleItem(id: string): void {
    this.selectedItemIds.update((set) => {
      const next = new Set(set);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  rerunTriage(): void {
    const id = this.route.snapshot.paramMap.get('id')!;
    this.casesService
      .triggerTriage(id)
      .pipe(take(1))
      .subscribe({ next: (c) => this.case.set(c) });
  }

  proceed(): void {
    if (!this.hasSelection() || this.saving()) return;
    const id = this.route.snapshot.paramMap.get('id')!;
    this.saving.set(true);
    this.casesService
      .updateCatalogSelection(id, [...this.selectedItemIds()])
      .pipe(take(1))
      .subscribe({
        next: () => this.router.navigate(['/cases', id, 'order']),
        error: () => this.saving.set(false),
      });
  }
}
