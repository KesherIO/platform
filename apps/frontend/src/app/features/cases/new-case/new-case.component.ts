import { Component, inject, signal, OnInit, DestroyRef } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { TranslatePipe, TranslateModule } from '@ngx-translate/core';
import { LowerCasePipe } from '@angular/common';
import {
  debounceTime,
  distinctUntilChanged,
  switchMap,
  take,
} from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  PatientSpecies,
  PatientSex,
  AgeUnit,
  CaseModel,
  CaseStatus,
} from '@vet-ai/shared-types';
import { CasesService } from '../shared/services/cases.service';
import { InputComponent } from '../../../shared/components';
import { SelectComponent } from '../../../shared/components';
import { ButtonComponent } from '../../../shared/components';

@Component({
  selector: 'app-new-case',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    TranslatePipe,
    TranslateModule,
    LowerCasePipe,
    RouterLink,
    InputComponent,
    SelectComponent,
    ButtonComponent,
  ],
  templateUrl: './new-case.component.html',
  styleUrl: './new-case.component.scss',
})
export class NewCaseComponent implements OnInit {
  private fb = inject(FormBuilder);
  private casesService = inject(CasesService);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  saving = signal(false);
  searchResults = signal<CaseModel[]>([]);
  selectedCase = signal<CaseModel | null>(null);
  showResults = signal(false);
  editCaseId = signal<string | null>(null);

  form = this.fb.group({
    patientName: ['', Validators.required],
    patientSpecies: ['', Validators.required],
    patientSex: [''],
    patientBreed: [''],
    patientDateOfBirth: [''],
    patientAge: [null as number | null],
    patientAgeUnit: [AgeUnit.YEARS],
    ownerName: ['', Validators.required],
    ownerPhone: [''],
  });

  readonly speciesOptions = [
    { value: PatientSpecies.DOG, label: 'CASES.NEW.SPECIES_DOG' },
    { value: PatientSpecies.CAT, label: 'CASES.NEW.SPECIES_CAT' },
    { value: PatientSpecies.EQUINE, label: 'CASES.NEW.SPECIES_EQUINE' },
    { value: PatientSpecies.BOVINE, label: 'CASES.NEW.SPECIES_BOVINE' },
    { value: PatientSpecies.BIRD, label: 'CASES.NEW.SPECIES_BIRD' },
    { value: PatientSpecies.REPTILE, label: 'CASES.NEW.SPECIES_REPTILE' },
    { value: PatientSpecies.RABBIT, label: 'CASES.NEW.SPECIES_RABBIT' },
    { value: PatientSpecies.OTHER, label: 'CASES.NEW.SPECIES_OTHER' },
  ];

  readonly sexOptions = [
    { value: PatientSex.MALE, label: 'CASES.NEW.SEX_MALE' },
    { value: PatientSex.FEMALE, label: 'CASES.NEW.SEX_FEMALE' },
    { value: PatientSex.UNKNOWN, label: 'CASES.NEW.SEX_UNKNOWN' },
  ];

  readonly ageUnitOptions = [
    { value: AgeUnit.DAYS, label: 'CASES.NEW.AGE_UNIT_DAYS' },
    { value: AgeUnit.WEEKS, label: 'CASES.NEW.AGE_UNIT_WEEKS' },
    { value: AgeUnit.MONTHS, label: 'CASES.NEW.AGE_UNIT_MONTHS' },
    { value: AgeUnit.YEARS, label: 'CASES.NEW.AGE_UNIT_YEARS' },
  ];

  ngOnInit(): void {
    // Prefill from router state (e.g. "New case for this patient" from case card menu)
    const state = history.state;
    const prefill = state?.prefill;
    if (state?.editCaseId) {
      this.editCaseId.set(state.editCaseId);
    }
    if (prefill) {
      this.form.patchValue({
        patientName: prefill.patientName ?? '',
        patientSpecies: prefill.patientSpecies ?? '',
        patientSex: prefill.patientSex ?? '',
        patientBreed: prefill.patientBreed ?? '',
        patientAge: prefill.patientAge ?? null,
        patientAgeUnit: prefill.patientAgeUnit ?? AgeUnit.YEARS,
        ownerName: prefill.ownerName ?? '',
      });
    }

    // Auto-calculate age from DOB
    this.form
      .get('patientDateOfBirth')!
      .valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((dob) => {
        if (!dob) return;
        const { age, unit } = this.calculateAge(dob);
        this.form.get('patientAge')!.setValue(age, { emitEvent: false });
        this.form.get('patientAgeUnit')!.setValue(unit, { emitEvent: false });
      });

    // Debounced patient name search
    this.form
      .get('patientName')!
      .valueChanges.pipe(
        debounceTime(350),
        distinctUntilChanged(),
        switchMap((q) => this.casesService.searchCases(q ?? '')),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((results) => {
        if (!this.selectedCase()) {
          this.searchResults.set(results);
          this.showResults.set(results.length > 0);
        }
      });
  }

  selectExistingCase(c: CaseModel): void {
    this.selectedCase.set(c);
    this.showResults.set(false);
    this.form.patchValue({
      patientName: c.patientName,
      patientSpecies: c.patientSpecies,
      patientSex: c.patientSex ?? '',
      patientBreed: c.patientBreed ?? '',
      patientAge: c.patientAge ?? null,
      patientAgeUnit: c.patientAgeUnit ?? AgeUnit.YEARS,
      ownerName: c.ownerName,
      ownerPhone: c.ownerPhone ?? '',
    });
    this.form.disable();
  }

  clearSelection(): void {
    this.selectedCase.set(null);
    this.form.enable();
    this.form.reset({ patientAgeUnit: AgeUnit.YEARS });
  }

  continueCase(): void {
    const c = this.selectedCase();
    if (!c) return;
    this.router.navigate(this.routeForCase(c));
  }

  viewResults(): void {
    const c = this.selectedCase();
    if (!c) return;
    this.router.navigate(['/cases', c.id, 'order']);
  }

  newCaseForPatient(): void {
    const v = this.form.value;
    this.selectedCase.set(null);
    this.form.enable();
    this.form.reset({
      patientName: v.patientName,
      patientSpecies: v.patientSpecies,
      patientSex: v.patientSex,
      patientBreed: v.patientBreed,
      patientDateOfBirth: v.patientDateOfBirth,
      patientAge: v.patientAge,
      patientAgeUnit: v.patientAgeUnit ?? AgeUnit.YEARS,
      ownerName: v.ownerName,
      ownerPhone: v.ownerPhone,
    });
  }

  submit(): void {
    if (this.form.invalid || this.saving()) return;
    this.saving.set(true);
    const v = this.form.value;
    const editId = this.editCaseId();
    const data = {
      patientName: v.patientName!,
      patientSpecies: v.patientSpecies as PatientSpecies,
      patientSex: v.patientSex ? (v.patientSex as PatientSex) : undefined,
      patientBreed: v.patientBreed || undefined,
      patientDateOfBirth: v.patientDateOfBirth || undefined,
      patientAge: v.patientAge ?? undefined,
      patientAgeUnit: (v.patientAgeUnit as AgeUnit) ?? undefined,
      ownerName: v.ownerName!,
      ownerPhone: v.ownerPhone || undefined,
    };
    if (editId) {
      this.casesService
        .updateCase(editId, data)
        .pipe(take(1))
        .subscribe({
          next: () => this.router.navigate(['/cases', editId, 'symptoms']),
          error: () => this.saving.set(false),
        });
    } else {
      this.casesService
        .createCase(data)
        .pipe(take(1))
        .subscribe({
          next: (c) => this.router.navigate(['/cases', c.id, 'symptoms']),
          error: () => this.saving.set(false),
        });
    }
  }

  private calculateAge(dob: string): { age: number; unit: AgeUnit } {
    const birth = new Date(dob);
    const now = new Date();
    const diffDays = Math.floor(
      (now.getTime() - birth.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (diffDays < 30) return { age: diffDays, unit: AgeUnit.DAYS };
    if (diffDays < 84)
      return { age: Math.floor(diffDays / 7), unit: AgeUnit.WEEKS };
    if (diffDays < 365)
      return { age: Math.floor(diffDays / 30), unit: AgeUnit.MONTHS };
    return { age: Math.floor(diffDays / 365), unit: AgeUnit.YEARS };
  }

  private routeForCase(c: CaseModel): string[] {
    switch (c.status) {
      case CaseStatus.OPEN:
        return ['/cases', c.id, 'symptoms'];
      case CaseStatus.TRIAGED:
        return ['/cases', c.id, 'ai-results'];
      default:
        return ['/cases', c.id, 'order'];
    }
  }
}
