import { Injectable, signal } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { delay, map } from 'rxjs/operators';
import {
  OnboardingState,
  OnboardingStep,
  ClinicSetupData,
  AdminProfileData,
  StaffProfileData,
  MagicLinkInvite,
} from '../models/onboarding.model';
import { TenantBranding } from '../models/tenant.model';

@Injectable({
  providedIn: 'root',
})
export class OnboardingService {
  private onboardingState = signal<OnboardingState>({
    tenantId: '',
    step: 'welcome',
    isFirstUser: true,
  });

  getOnboardingState() {
    return this.onboardingState.asReadonly();
  }

  // Initialize onboarding from tenantId in URL
  initializeOnboarding(tenantId: string, inviteToken?: string): Observable<TenantBranding> {
    // TODO: Replace with actual API call
    return of({
      tenantId,
      tenantName: 'LabX',
      logoUrl: '/assets/icons/icon-128x128.png',
      primaryColor: '#06D6A0',
    }).pipe(
      delay(500),
      map((branding) => {
        this.onboardingState.update((state) => ({
          ...state,
          tenantId,
          inviteToken,
          isFirstUser: !inviteToken,
          step: inviteToken ? 'staff-profile' : 'welcome',
        }));
        return branding;
      })
    );
  }

  // Check if clinic is already set up
  checkClinicSetup(_tenantId: string): Observable<boolean> {
    // TODO: Replace with actual API call
    return of(false).pipe(delay(300));
  }

  // Save clinic setup (admin only)
  saveClinicSetup(clinicData: ClinicSetupData): Observable<{ clinicId: string }> {
    // TODO: Replace with actual API call
    return of({ clinicId: 'clinic-123' }).pipe(
      delay(800),
      map((response) => {
        this.onboardingState.update((state) => ({
          ...state,
          clinic: clinicData,
          step: 'admin-profile',
        }));
        return response;
      })
    );
  }

  // Save admin profile
  saveAdminProfile(profileData: AdminProfileData): Observable<{ userId: string }> {
    // TODO: Replace with actual API call
    return of({ userId: 'user-123' }).pipe(
      delay(800),
      map((response) => {
        this.onboardingState.update((state) => ({
          ...state,
          adminProfile: profileData,
          step: 'staff-invite',
        }));
        return response;
      })
    );
  }

  // Save staff profile
  saveStaffProfile(_profileData: StaffProfileData): Observable<{ userId: string }> {
    // TODO: Replace with actual API call
    return of({ userId: 'user-456' }).pipe(
      delay(800),
      map((response) => {
        this.onboardingState.update((state) => ({
          ...state,
          step: 'complete',
        }));
        return response;
      })
    );
  }

  // Generate magic link for staff invites
  generateMagicLink(): Observable<MagicLinkInvite> {
    const state = this.onboardingState();

    if (!state.tenantId) {
      return throwError(() => new Error('Tenant ID is required'));
    }

    // TODO: Replace with actual API call
    const invite: MagicLinkInvite = {
      clinicId: 'clinic-123',
      tenantId: state.tenantId,
      invitedBy: 'admin-user',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      token: `invite-${Math.random().toString(36).substring(2, 15)}`,
    };

    return of(invite).pipe(delay(500));
  }

  // Send magic link via email
  sendMagicLinkEmail(_email: string): Observable<boolean> {
    // TODO: Replace with actual API call
    return of(true).pipe(delay(1000));
  }

  // Verify magic link token
  verifyMagicLink(_token: string): Observable<{ tenantId: string; clinicId: string }> {
    // TODO: Replace with actual API call
    return of({
      tenantId: 'tenant-123',
      clinicId: 'clinic-123',
    }).pipe(delay(500));
  }

  // Update current step
  updateStep(step: OnboardingStep): void {
    this.onboardingState.update((state) => ({
      ...state,
      step,
    }));
  }

  // Reset onboarding state
  resetOnboarding(): void {
    this.onboardingState.set({
      tenantId: '',
      step: 'welcome',
      isFirstUser: true,
    });
  }

  // Complete onboarding
  completeOnboarding(): Observable<boolean> {
    // TODO: Replace with actual API call to mark user/clinic as active
    return of(true).pipe(
      delay(500),
      map(() => {
        this.onboardingState.update((state) => ({
          ...state,
          step: 'complete',
        }));
        return true;
      })
    );
  }
}