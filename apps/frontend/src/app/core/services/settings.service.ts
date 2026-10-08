import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { ClinicProfileModel, StaffMember } from '@vet-ai/shared-types';
import { TenantService } from './tenant.service';

export type InviteErrorType =
  | 'capacity_exceeded'
  | 'already_member'
  | 'unknown';
export type StaffErrorType = 'last_admin' | 'unknown';

/** Body for PATCH /api/tenants/:id — the clinic email is locked and not sent. */
export type ClinicProfileUpdate = Partial<
  Record<keyof Omit<ClinicProfileModel, 'email'>, string>
>;

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
  private readonly tenant = inject(TenantService);

  private get tenantId(): string {
    return this.tenant.activeTenantId() ?? '';
  }

  private get tenantHeaders() {
    return { headers: { 'x-tenant-id': this.tenantId } };
  }

  // ---------------------------------------------------------------------------
  // Staff invitations
  // ---------------------------------------------------------------------------

  generateMagicLink(
    email?: string,
    role: 'vet' | 'technician' | 'receptionist' = 'vet'
  ): Observable<MagicLinkResult> {
    const tenantId = this.tenantId;
    const body = email ? { email, role } : { role };
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
          url: `/onboarding/staff?token=${res.token}&tenantId=${res.tenantId}`,
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

  updateRole(
    userId: string,
    role: 'admin' | 'vet' | 'technician' | 'receptionist'
  ): Observable<void> {
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

  /**
   * Update the shared clinic profile. Omitted fields are kept as they are;
   * '' clears an optional field.
   */
  updateClinic(data: ClinicProfileUpdate, logoFile?: File): Observable<void> {
    const tenantId = this.tenantId;
    let body: FormData | ClinicProfileUpdate;

    if (logoFile) {
      const fd = new FormData();
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) fd.append(key, value);
      }
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
