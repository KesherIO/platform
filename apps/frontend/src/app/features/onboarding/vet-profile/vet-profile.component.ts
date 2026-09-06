import { Component, OnInit, signal, inject, DestroyRef } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import {
  FormBuilder,
  FormGroup,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { switchMap, of, take, catchError } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { VetProfileService } from '../../../core/services/vet-profile.service';
import { AuthService } from '../../../core/services/auth.service';
import { InputComponent } from '../../../shared/components/input/input.component';
import { SelectComponent } from '../../../shared/components/select/select.component';
import { PrimaryButtonComponent } from '../../../shared/components/primary-button/primary-button.component';
import { AuthBrandingComponent } from '../../../shared/components/auth-branding/auth-branding.component';
import { COUNTRIES } from '../../../core/data/countries';
import { VeterinarianProfileModel } from '@vet-ai/shared-types';

const ALLOWED_DOC_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
];
const MAX_DOC_SIZE = 10 * 1024 * 1024;

@Component({
  selector: 'app-vet-profile',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    TranslatePipe,
    InputComponent,
    SelectComponent,
    PrimaryButtonComponent,
    AuthBrandingComponent,
  ],
  templateUrl: './vet-profile.component.html',
  styleUrls: ['./vet-profile.component.scss'],
})
export class VetProfileComponent implements OnInit {
  private fb = inject(FormBuilder);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private vetProfileService = inject(VetProfileService);
  private authService = inject(AuthService);
  private destroyRef = inject(DestroyRef);

  form!: FormGroup;
  readonly countryOptions = COUNTRIES;

  mode = signal<'create' | 'edit'>('create');
  viewState = signal<'loading' | 'form' | 'ready-to-submit'>('loading');
  saving = signal(false);
  submitting = signal(false);
  error = signal<string | null>(null);

  pendingDocFile = signal<File | null>(null);
  docFileName = signal<string | null>(null);
  docError = signal<string | null>(null);
  hasExistingDoc = signal(false);

  private existingProfile: VeterinarianProfileModel | null = null;

  ngOnInit(): void {
    const modeParam = this.route.snapshot.queryParamMap.get('mode');
    this.mode.set(modeParam === 'edit' ? 'edit' : 'create');

    this.form = this.fb.group({
      legalName: ['', [Validators.required, Validators.minLength(2)]],
      licenseNumber: ['', [Validators.required]],
      issuingCountry: ['', [Validators.required]],
      issuingAuthority: [''],
      licenseExpiresAt: [''],
    });

    const init$ = this.authService.me()
      ? of(null)
      : this.authService.loadMe().pipe(catchError(() => of(null)));

    init$
      .pipe(
        switchMap(() => this.vetProfileService.getProfile()),
        take(1),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (profile) => {
          this.existingProfile = profile;
          this.form.patchValue({ legalName: profile.legalName });
          const cred = profile.activeCredential;
          if (cred) {
            this.form.patchValue({
              licenseNumber: cred.licenseNumber,
              issuingCountry: cred.issuingCountry,
              issuingAuthority: cred.issuingAuthority ?? '',
              licenseExpiresAt: cred.licenseExpiresAt
                ? cred.licenseExpiresAt.substring(0, 10)
                : '',
            });
            this.hasExistingDoc.set(true);
          }
          this.viewState.set('form');
        },
        error: () => {
          // 404 = no profile yet; any other error — show empty form rather than blocking the user
          this.viewState.set('form');
        },
      });
  }

  onDocFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    this.docError.set(null);
    if (!file) return;

    if (!ALLOWED_DOC_TYPES.includes(file.type)) {
      this.docError.set('VET_PROFILE.DOCUMENT_TYPE_ERROR');
      return;
    }
    if (file.size > MAX_DOC_SIZE) {
      this.docError.set('VET_PROFILE.DOCUMENT_SIZE_ERROR');
      return;
    }
    this.pendingDocFile.set(file);
    this.docFileName.set(file.name);
  }

  get isSaveDisabled(): boolean {
    return (
      this.form.invalid || (!this.hasExistingDoc() && !this.pendingDocFile())
    );
  }

  onSave(): void {
    if (this.isSaveDisabled) return;
    this.saving.set(true);
    this.error.set(null);

    const {
      legalName,
      licenseNumber,
      issuingCountry,
      issuingAuthority,
      licenseExpiresAt,
    } = this.form.value;

    const profileOp$ = this.existingProfile
      ? this.vetProfileService.updateProfile(legalName)
      : this.vetProfileService.createProfile(legalName);

    profileOp$
      .pipe(
        switchMap((profile) => {
          this.existingProfile = profile;
          const docFile = this.pendingDocFile();
          if (docFile) {
            return this.vetProfileService.uploadCredential({
              file: docFile,
              licenseNumber,
              issuingCountry,
              issuingAuthority: issuingAuthority || undefined,
              licenseExpiresAt: licenseExpiresAt || undefined,
            });
          }
          return of(null);
        }),
        take(1),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: () => {
          this.saving.set(false);
          if (this.mode() === 'edit') {
            this.doSubmit();
          } else {
            this.viewState.set('ready-to-submit');
          }
        },
        error: () => {
          this.saving.set(false);
          this.error.set('VET_PROFILE.SAVE_ERROR');
        },
      });
  }

  onSubmitForReview(): void {
    this.doSubmit();
  }

  private doSubmit(): void {
    this.submitting.set(true);
    this.error.set(null);
    this.vetProfileService
      .submitVerification()
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.submitting.set(false);
          this.router.navigate(['/onboarding/verification-pending']);
        },
        error: () => {
          this.submitting.set(false);
          this.error.set('VET_PROFILE.SUBMIT_ERROR');
        },
      });
  }
}
