import { Component, inject, signal, OnInit, DestroyRef } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import {
  TranslatePipe,
  TranslateModule,
  TranslateService,
} from '@ngx-translate/core';
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
  EligibleVetModel,
} from '@vet-ai/shared-types';
import { CasesService } from '../shared/services/cases.service';
import { AuthService } from '../../../core/services/auth.service';
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
  private auth = inject(AuthService);
  private translate = inject(TranslateService);

  saving = signal(false);
  searchResults = signal<CaseModel[]>([]);
  selectedCase = signal<CaseModel | null>(null);
  showResults = signal(false);
  editCaseId = signal<string | null>(null);
  vets = signal<EligibleVetModel[]>([]);
  vetOptions = signal<{ value: string; label: string; disabled?: boolean }[]>(
    []
  );

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
    attendingVetId: [''],
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
        patientDateOfBirth: prefill.patientDateOfBirth
          ? new Date(prefill.patientDateOfBirth).toISOString().split('T')[0]
          : '',
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

    // Load eligible vets
    this.casesService
      .getEligibleVets()
      .pipe(take(1))
      .subscribe({
        next: (vets) => {
          this.vets.set(vets);
          this.vetOptions.set(this.buildVetOptions(vets));
          this.preselectSelfIfEligible(vets);
        },
      });
  }

  private buildVetOptions(
    vets: EligibleVetModel[]
  ): { value: string; label: string; disabled?: boolean }[] {
    return vets.map((vet) => {
      const isActive = vet.status === 'ACTIVE';
      let label = vet.fullName || vet.email;
      if (!isActive) {
        const statusLabel = this.translate.instant(
          this.vetStatusKey(vet.status)
        );
        label = `${label} ${statusLabel}`;
      }
      return { value: vet.userId, label, disabled: !isActive };
    });
  }

  private vetStatusKey(status: string): string {
    const keys: Record<string, string> = {
      PROFILE_REQUIRED: 'CASES.VET_STATUS.PROFILE_REQUIRED',
      VERIFICATION_PENDING: 'CASES.VET_STATUS.VERIFICATION_PENDING',
      SUSPENDED: 'CASES.VET_STATUS.SUSPENDED',
      INVITED: 'CASES.VET_STATUS.INVITED',
    };
    return keys[status] ?? 'CASES.VET_STATUS.PROFILE_REQUIRED';
  }

  private preselectSelfIfEligible(vets: EligibleVetModel[]): void {
    const me = this.auth.me();
    if (!me) return;
    const myMembership = me.memberships?.[0];
    if (!myMembership?.isOrderingVet || myMembership.status !== 'ACTIVE')
      return;
    const selfInList = vets.find((v) => v.userId === me.user.id);
    if (selfInList) {
      this.form.get('attendingVetId')!.setValue(me.user.id);
    }
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
    const rawAge = v.patientAge;
    const patientAge =
      rawAge !== null && rawAge !== undefined && rawAge !== ('' as unknown)
        ? Number(rawAge)
        : undefined;
    const data = {
      patientName: v.patientName!,
      patientSpecies: v.patientSpecies as PatientSpecies,
      patientSex: v.patientSex ? (v.patientSex as PatientSex) : undefined,
      patientBreed: v.patientBreed || undefined,
      patientDateOfBirth: v.patientDateOfBirth || undefined,
      patientAge,
      patientAgeUnit:
        patientAge !== undefined ? (v.patientAgeUnit as AgeUnit) : undefined,
      ownerName: v.ownerName!,
      ownerPhone: v.ownerPhone || undefined,
      attendingVetId: v.attendingVetId || undefined,
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
