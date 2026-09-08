import { Injectable, inject, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import type { MeResponse } from './auth.service';

function storageKey(userId: string): string {
  return `kesherio:active-clinic:${userId}`;
}

@Injectable({ providedIn: 'root' })
export class TenantService {
  private readonly router = inject(Router);
  private readonly cacheCleaners: (() => void)[] = [];

  private readonly _activeTenantId = signal<string | null>(null);
  private readonly _clinics = signal<MeResponse['memberships']>([]);
  private readonly _userId = signal<string | null>(null);

  readonly activeTenantId = this._activeTenantId.asReadonly();

  readonly clinics = this._clinics.asReadonly();

  readonly activeMembership = computed(() => {
    const id = this._activeTenantId();
    if (!id) return null;
    return this._clinics().find((m) => m.tenant.id === id) ?? null;
  });

  readonly hasMultipleClinics = computed(() => this._clinics().length > 1);

  readonly needsClinicSelection = computed(
    () => this._clinics().length > 1 && this._activeTenantId() === null
  );

  registerCacheCleaner(fn: () => void): void {
    this.cacheCleaners.push(fn);
  }

  resolve(me: MeResponse): void {
    const clinics = me.memberships;
    const userId = me.user.id;
    this._clinics.set(clinics);
    this._userId.set(userId);

    if (clinics.length === 0) {
      this._activeTenantId.set(null);
      return;
    }

    if (clinics.length === 1) {
      this._activeTenantId.set(clinics[0].tenant.id);
      this.saveToStorage(userId, clinics[0].tenant.id);
      return;
    }

    const saved = localStorage.getItem(storageKey(userId));
    if (saved && clinics.some((m) => m.tenant.id === saved)) {
      this._activeTenantId.set(saved);
      return;
    }

    if (saved) {
      localStorage.removeItem(storageKey(userId));
    }
    this._activeTenantId.set(null);
  }

  selectClinic(tenantId: string): void {
    const clinics = this._clinics();
    const userId = this._userId();
    if (!clinics.some((m) => m.tenant.id === tenantId)) return;

    this._activeTenantId.set(tenantId);
    if (userId) {
      this.saveToStorage(userId, tenantId);
    }

    this.cacheCleaners.forEach((fn) => fn());
    this.router.navigate(['/dashboard']);
  }

  clearSelection(): void {
    this._activeTenantId.set(null);
    this._clinics.set([]);
    this._userId.set(null);
  }

  static savePreference(userId: string, tenantId: string): void {
    localStorage.setItem(storageKey(userId), tenantId);
  }

  private saveToStorage(userId: string, tenantId: string): void {
    localStorage.setItem(storageKey(userId), tenantId);
  }
}
