import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { StaffMember } from '@vet-ai/shared-types';
import { AuthService } from './auth.service';

export type InviteErrorType =
  | 'capacity_exceeded'
  | 'already_member'
  | 'unknown';
export type StaffErrorType = 'last_admin' | 'unknown';

export interface MagicLinkResult {
  url: string;
  token: string;
  alreadyExists: boolean;
}

export interface LabContact {
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  logoUrl: string | null;
  phoneNumbers: { label: string; number: string }[] | null;
  mapLat: number | null;
  mapLng: number | null;
}

@Injectable({
  providedIn: 'root',
})
export class SettingsService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  private get tenantId(): string {
    const me = this.auth.me();
    return me?.activeTenantId ?? me?.tenants[0]?.id ?? '';
  }

  private get tenantHeaders() {
    return { headers: { 'x-tenant-id': this.tenantId } };
  }

  // ---------------------------------------------------------------------------
  // Staff invitations
  // ---------------------------------------------------------------------------

  generateMagicLink(email?: string): Observable<MagicLinkResult> {
    const tenantId = this.tenantId;
    const body = email ? { email, role: 'staff' } : {};
    return this.http
      .post<{
        token: string;
        tenantId: string;
        expiresAt: string;
        alreadyExists: boolean;
      }>(`/api/onboarding/invite?tenantId=${tenantId}`, body)
      .pipe(
        map((res) => ({
          token: res.token,
          url: `${window.location.origin}/onboarding/staff?token=${res.token}&tenantId=${res.tenantId}`,
          alreadyExists: res.alreadyExists,
        })),
        catchError((err: HttpErrorResponse) => {
          let type: InviteErrorType;
          if (err.status === 409) type = 'already_member';
          else if (err.status === 400) type = 'capacity_exceeded';
          else type = 'unknown';
          return throwError(() => ({ type }));
        })
      );
  }

  // ---------------------------------------------------------------------------
  // Staff members
  // ---------------------------------------------------------------------------

  getStaffMembers(): Observable<StaffMember[]> {
    return this.http.get<StaffMember[]>(
      `/api/tenants/${this.tenantId}/staff`,
      this.tenantHeaders
    );
  }

  removeStaff(userId: string): Observable<void> {
    return this.http
      .delete<void>(
        `/api/tenants/${this.tenantId}/staff/${userId}`,
        this.tenantHeaders
      )
      .pipe(catchError((err: HttpErrorResponse) => this.mapStaffError(err)));
  }

  updateRole(userId: string, role: 'admin' | 'staff'): Observable<void> {
    return this.http
      .patch<void>(
        `/api/tenants/${this.tenantId}/staff/${userId}/role`,
        { role },
        this.tenantHeaders
      )
      .pipe(catchError((err: HttpErrorResponse) => this.mapStaffError(err)));
  }

  // ---------------------------------------------------------------------------
  // Clinic
  // ---------------------------------------------------------------------------

  updateClinic(
    data: { name?: string; phone?: string; address?: string },
    logoFile?: File
  ): Observable<void> {
    const tenantId = this.tenantId;
    let body: FormData | { name?: string; phone?: string };

    if (logoFile) {
      const fd = new FormData();
      if (data.name !== undefined) fd.append('name', data.name);
      if (data.phone !== undefined) fd.append('phone', data.phone);
      if (data.address !== undefined) fd.append('address', data.address);
      fd.append('logo', logoFile);
      body = fd;
    } else {
      body = data;
    }

    return this.http.patch<void>(
      `/api/tenants/${tenantId}`,
      body,
      this.tenantHeaders
    );
  }

  // ---------------------------------------------------------------------------
  // Lab contact (clinic-side)
  // ---------------------------------------------------------------------------

  getLabContact(): Observable<LabContact> {
    return this.http.get<LabContact>(
      `/api/tenants/${this.tenantId}/lab-contact`,
      this.tenantHeaders
    );
  }

  private mapStaffError(err: HttpErrorResponse): Observable<never> {
    const type: StaffErrorType =
      err.status === 409 && err.error?.message === 'last_admin'
        ? 'last_admin'
        : 'unknown';
    return throwError(() => ({ type }));
  }
}
