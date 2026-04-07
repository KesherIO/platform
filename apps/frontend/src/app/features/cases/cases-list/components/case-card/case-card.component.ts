import { Component, input, output, computed, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { CaseModel, CaseStatus } from '@vet-ai/shared-types';
import { CaseStatusBadgeComponent } from '../../../shared/components/case-status-badge/case-status-badge.component';
import { SpeciesIconComponent } from '../species-icon/species-icon.component';

@Component({
  selector: 'app-case-card',
  standalone: true,
  imports: [
    RouterLink,
    TranslatePipe,
    CaseStatusBadgeComponent,
    SpeciesIconComponent,
  ],
  templateUrl: './case-card.component.html',
  styleUrl: './case-card.component.scss',
})
export class CaseCardComponent {
  case = input.required<CaseModel>();
  route = input.required<string[]>();
  menuOpenId = input<string | null>(null);
  menuToggled = output<string | null>();

  menuOpen = computed(() => this.menuOpenId() === this.case().id);

  private router = inject(Router);

  toggleMenu(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.menuToggled.emit(this.menuOpen() ? null : this.case().id);
  }

  navigate(path: string[]): void {
    this.menuToggled.emit(null);
    const c = this.case();
    if (c.status === CaseStatus.OPEN && path[2] === 'symptoms') {
      this.router.navigate(['/cases/new'], {
        state: { editCaseId: c.id, prefill: this.prefillFromCase(c) },
      });
      return;
    }
    this.router.navigate(path);
  }

  navigateNewCaseForPatient(): void {
    this.menuToggled.emit(null);
    this.router.navigate(['/cases/new'], {
      state: { prefill: this.prefillFromCase(this.case()) },
    });
  }

  private prefillFromCase(c: CaseModel) {
    return {
      patientName: c.patientName,
      patientSpecies: c.patientSpecies,
      patientSex: c.patientSex,
      patientBreed: c.patientBreed,
      patientAge: c.patientAge,
      patientAgeUnit: c.patientAgeUnit,
      ownerName: c.ownerName,
    };
  }

  formatDate(date: Date | string): string {
    const d = new Date(date);
    const now = new Date();
    const diffDays = Math.floor(
      (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return '1d';
    if (diffDays < 7) return `${diffDays}d`;
    const sameYear = d.getFullYear() === now.getFullYear();
    return sameYear
      ? d.toLocaleDateString('en-US', { day: '2-digit', month: 'short' })
      : d.toLocaleDateString('en-US', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        });
  }

  formatAge(age?: number, unit?: string): string {
    if (age == null) return '';
    return `${age} ${unit?.toLowerCase() ?? ''}`;
  }

  protected readonly CaseStatus = CaseStatus;
}
