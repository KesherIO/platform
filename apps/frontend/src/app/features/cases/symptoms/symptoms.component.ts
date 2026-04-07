import { Component, inject, signal, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
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
  case = signal<CaseModel | null>(null);

  form = this.fb.group({
    symptoms: ['', Validators.required],
  });

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

  submit(): void {
    if (this.form.invalid || this.saving()) return;
    const c = this.case();
    if (!c) return;
    this.saving.set(true);
    this.casesService
      .updateSymptoms(c.id, this.form.value.symptoms!)
      .pipe(take(1))
      .subscribe({
        next: () => this.router.navigate(['/cases', c.id, 'ai-results']),
        error: () => this.saving.set(false),
      });
  }
}
