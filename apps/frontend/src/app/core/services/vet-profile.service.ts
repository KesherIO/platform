import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { VeterinarianProfileModel } from '@vet-ai/shared-types';
import { AuthService } from './auth.service';

export interface VetVerificationStatusResponse {
  status: string;
  rejectionReason: string | null;
  submittedAt: string | null;
  labName: string | null;
  required: boolean;
}

export interface SubmitVerificationResponse {
  verificationId: string;
  status: string;
  submittedAt: string;
}

@Injectable({ providedIn: 'root' })
export class VetProfileService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  private get tenantHeaders() {
    const me = this.auth.me();
    const tenantId = me?.activeTenantId ?? me?.memberships[0]?.tenant.id ?? '';
    return { headers: { 'x-tenant-id': tenantId } };
  }

  getProfile(): Observable<VeterinarianProfileModel> {
    return this.http.get<VeterinarianProfileModel>(
      '/api/vet-profile',
      this.tenantHeaders
    );
  }

  createProfile(legalName: string): Observable<VeterinarianProfileModel> {
    return this.http.post<VeterinarianProfileModel>(
      '/api/vet-profile',
      { legalName },
      this.tenantHeaders
    );
  }

  updateProfile(legalName: string): Observable<VeterinarianProfileModel> {
    return this.http.patch<VeterinarianProfileModel>(
      '/api/vet-profile',
      { legalName },
      this.tenantHeaders
    );
  }

  uploadCredential(data: {
    file: File;
    licenseNumber: string;
    issuingCountry: string;
    issuingAuthority?: string;
    licenseExpiresAt?: string;
  }): Observable<{ credentialId: string; documentKey: string }> {
    const form = new FormData();
    form.append('file', data.file);
    form.append('licenseNumber', data.licenseNumber);
    form.append('issuingCountry', data.issuingCountry);
    if (data.issuingAuthority)
      form.append('issuingAuthority', data.issuingAuthority);
    if (data.licenseExpiresAt)
      form.append('licenseExpiresAt', data.licenseExpiresAt);
    return this.http.post<{ credentialId: string; documentKey: string }>(
      '/api/vet-profile/credential',
      form,
      this.tenantHeaders
    );
  }

  getVerificationStatus(): Observable<VetVerificationStatusResponse | null> {
    return this.http.get<VetVerificationStatusResponse | null>(
      '/api/vet-verification/status',
      this.tenantHeaders
    );
  }

  submitVerification(): Observable<SubmitVerificationResponse> {
    return this.http.post<SubmitVerificationResponse>(
      '/api/vet-verification/submit',
      {},
      this.tenantHeaders
    );
  }
}
