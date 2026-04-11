import { Component, inject, signal, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ReactiveFormsModule, FormBuilder } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { take } from 'rxjs';
import { CaseModel } from '@vet-ai/shared-types';
import { CasesService } from '../shared/services/cases.service';
import { CaseWizardLayoutComponent } from '../shared/components/case-wizard-layout/case-wizard-layout.component';
import { ButtonComponent } from '../../../shared/components';

@Component({
  selector: 'app-symptoms',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    TranslatePipe,
    CaseWizardLayoutComponent,
    ButtonComponent,
  ],
  templateUrl: './symptoms.component.html',
  styleUrl: './symptoms.component.scss',
})
export class SymptomsComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private casesService = inject(CasesService);
  private fb = inject(FormBuilder);

  loading = signal(true);
  saving = signal(false);
  runningAi = signal(false);
  case = signal<CaseModel | null>(null);

  form = this.fb.group({
    symptoms: [''],
  });

  get isBusy(): boolean {
    return this.saving() || this.runningAi();
  }

  get hasSymptoms(): boolean {
    return !!this.form.value.symptoms?.trim();
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id')!;
    this.casesService
      .getCase(id)
      .pipe(take(1))
      .subscribe({
        next: (c) => {
          this.case.set(c);
          this.loading.set(false);
          if (c.symptoms) {
            this.form.patchValue({ symptoms: c.symptoms });
          }
        },
        error: () => this.loading.set(false),
      });
  }

  private get caseId(): string {
    return this.route.snapshot.paramMap.get('id')!;
  }

  runAi(): void {
    if (!this.hasSymptoms || this.isBusy) return;
    const id = this.caseId;
    this.saving.set(true);
    this.casesService
      .updateSymptoms(id, this.form.value.symptoms!)
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.runningAi.set(true);
          this.casesService
            .triggerTriage(id)
            .pipe(take(1))
            .subscribe({
              next: () => this.router.navigate(['/cases', id, 'ai-results']),
              error: () => this.runningAi.set(false),
            });
        },
        error: () => this.saving.set(false),
      });
  }

  skipAi(): void {
    if (this.isBusy) return;
    const id = this.caseId;
    this.saving.set(true);
    this.casesService
      .updateSymptoms(id, this.form.value.symptoms!)
      .pipe(take(1))
      .subscribe({
        next: () => this.router.navigate(['/cases', id, 'test-selection']),
        error: () => this.saving.set(false),
      });
  }
}
