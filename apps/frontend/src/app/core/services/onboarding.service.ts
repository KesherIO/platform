import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import {
  OnboardingState,
  OnboardingStep,
  ClinicSetupData,
  AdminProfileDraft,
  StaffProfileData,
  MagicLinkInvite,
  TenantBranding,
  VerifyOnboardingTokenResponse,
  CompleteAdminOnboardingRequest,
  CompleteAdminOnboardingResponse,
} from '../models';

/** Default logo shown when the tenant has not uploaded a custom logo. */
export const DEFAULT_LOGO_URL = '/assets/icons/icon-128x128.png';

/** Resolve a Tenant logoUrl to a displayable URL, falling back to the default app icon. */
export function resolveLogoUrl(logoUrl: string | null | undefined): string {
  return logoUrl || DEFAULT_LOGO_URL;
}

@Injectable({
  providedIn: 'root',
})
export class OnboardingService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = '/api/onboarding';

  private onboardingState = signal<OnboardingState>({
    tenantId: '',
    step: 'welcome',
    isFirstUser: true,
  });

  getOnboardingState() {
    return this.onboardingState.asReadonly();
  }

  // ---------------------------------------------------------------------------
  // Welcome screen — fetch tenant branding and seed local state.
  // Used when tenantId is already known (e.g. staff invite flow).
  // ---------------------------------------------------------------------------

  initializeOnboarding(tenantId: string, inviteToken?: string): Observable<TenantBranding> {
    return this.http.get<TenantBranding>(`${this.apiBase}/${tenantId}/branding`).pipe(
      tap((branding) => {
        this.onboardingState.update((state) => ({
          ...state,
          tenantId,
          inviteToken,
          isFirstUser: !inviteToken,
          step: inviteToken ? 'staff-profile' : 'welcome',
        }));
        Object.assign(branding, { tenantId });
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // Clinic setup — token-based flow (no API call, data stored locally)
  // Everything is sent to the server in one shot via completeAdminOnboarding().
  // ---------------------------------------------------------------------------

  storeClinicSetup(clinicData: ClinicSetupData): void {
    // Merge the read-only clinic email from token verify state
    // (the form doesn't contain an editable email field).
    const currentEmail = this.onboardingState().prefillClinicEmail ?? '';
    this.onboardingState.update((state) => ({
      ...state,
      clinic: { ...clinicData, email: currentEmail },
      step: 'admin-profile',
    }));
  }

  /** Save clinic form data without advancing the step — used when navigating back. */
  storeClinicSetupDraft(clinicData: ClinicSetupData): void {
    const currentEmail = this.onboardingState().prefillClinicEmail ?? '';
    this.onboardingState.update((state) => ({
      ...state,
      clinic: { ...clinicData, email: currentEmail },
    }));
  }

  /** Save admin profile fields (no passwords) without advancing the step — used when navigating back. */
  storeAdminProfileDraft(draft: AdminProfileDraft): void {
    this.onboardingState.update((state) => ({
      ...state,
      adminProfileDraft: draft,
    }));
  }

  // ---------------------------------------------------------------------------
  // Staff profile (invite acceptance)
  // ---------------------------------------------------------------------------

  saveStaffProfile(profileData: StaffProfileData): Observable<{ userId: string }> {
    const { tenantId, inviteToken } = this.onboardingState();

    if (!inviteToken) {
      return throwError(() => new Error('No invite token in onboarding state'));
    }

    const body = { ...profileData, token: inviteToken };

    return this.http
      .post<{ userId: string }>(`${this.apiBase}/staff-profile?tenantId=${tenantId}`, body)
      .pipe(
        tap(() => {
          this.onboardingState.update((state) => ({
            ...state,
            step: 'complete',
          }));
        }),
      );
  }

  // ---------------------------------------------------------------------------
  // Generate magic link
  // ---------------------------------------------------------------------------

  generateMagicLink(): Observable<MagicLinkInvite> {
    const { tenantId } = this.onboardingState();

    if (!tenantId) {
      return throwError(() => new Error('Tenant ID is required'));
    }

    const body = { email: '', role: 'vet' };

    return this.http
      .post<{ token: string; tenantId: string; expiresAt: string }>(
        `${this.apiBase}/invite?tenantId=${tenantId}`,
        body,
      )
      .pipe(
        map((response) => ({
          clinicId: tenantId,
          tenantId: response.tenantId,
          invitedBy: '',
          expiresAt: new Date(response.expiresAt),
          token: response.token,
        })),
      );
  }

  // ---------------------------------------------------------------------------
  // Verify magic link token
  // ---------------------------------------------------------------------------

  verifyMagicLink(token: string): Observable<{ tenantId: string; tenantName: string }> {
    return this.http.get<{ tenantId: string; tenantName: string }>(
      `${this.apiBase}/invite/verify/${token}`,
    );
  }

  // ---------------------------------------------------------------------------
  // Verify admin onboarding token (new token-based flow)
  // Public — no JWT required. Called by WelcomeComponent on page load.
  // ---------------------------------------------------------------------------

  verifyOnboardingToken(token: string): Observable<VerifyOnboardingTokenResponse> {
    return this.http
      .get<VerifyOnboardingTokenResponse>(`${this.apiBase}/verify/${token}`)
      .pipe(
        tap((response) => {
          if (response.valid) {
            this.onboardingState.update((state) => ({
              ...state,
              onboardingToken: token,
              prefillClinicName: response.clinicName,
              prefillClinicEmail: response.clinicEmail,
              step: 'clinic-setup',
            }));
          }
        }),
      );
  }

  // ---------------------------------------------------------------------------
  // Complete admin onboarding — POST /onboarding/complete (public, no JWT)
  // Creates Supabase user + Tenant + ADMIN membership atomically.
  // If a pendingLogoFile is present, sends multipart/form-data so the logo
  // is uploaded and linked to the tenant in a single atomic request.
  // ---------------------------------------------------------------------------

  completeAdminOnboarding(
    dto: CompleteAdminOnboardingRequest,
    logoFile?: File,
  ): Observable<CompleteAdminOnboardingResponse> {
    let body: FormData | CompleteAdminOnboardingRequest;

    if (logoFile) {
      const formData = new FormData();
      // Append all scalar fields individually so NestJS can parse them
      (Object.keys(dto) as (keyof CompleteAdminOnboardingRequest)[]).forEach((key) => {
        const val = dto[key];
        if (val !== undefined) formData.append(key, val);
      });
      formData.append('logo', logoFile);
      body = formData;
    } else {
      body = dto;
    }

    return this.http
      .post<CompleteAdminOnboardingResponse>(`${this.apiBase}/complete`, body)
      .pipe(
        tap(() => {
          this.onboardingState.update((state) => ({ ...state, step: 'complete' }));
        }),
      );
  }

  // ---------------------------------------------------------------------------
  // Utility
  // ---------------------------------------------------------------------------

  updateStep(step: OnboardingStep): void {
    this.onboardingState.update((state) => ({ ...state, step }));
  }

  resetOnboarding(): void {
    this.onboardingState.set({
      tenantId: '',
      step: 'welcome',
      isFirstUser: true,
    });
  }

  completeOnboarding(): Observable<boolean> {
    return new Observable<boolean>((observer) => {
      this.onboardingState.update((state) => ({ ...state, step: 'complete' }));
      observer.next(true);
      observer.complete();
    });
  }
}