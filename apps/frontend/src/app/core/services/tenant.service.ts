import { Injectable, inject, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import type { MeResponse } from './auth.service';

/** The API refused because the clinic's lab suspended services. */
export function isLabServicesSuspendedError(err: unknown): boolean {
  return (
    (err as { error?: { code?: string } } | null)?.error?.code ===
    'LAB_SERVICES_SUSPENDED'
  );
}

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

  /** The active clinic's lab has suspended services for it. */
  readonly labServicesSuspended = computed(
    () => this.activeMembership()?.labServicesSuspended ?? false
  );

  readonly needsClinicSelection = computed(
    () => this._clinics().length > 1 && this._activeTenantId() === null
  );

  /** A request was refused mid-session — show the notice without a reload. */
  markLabServicesSuspended(): void {
    const id = this._activeTenantId();
    this._clinics.update((clinics) =>
      clinics.map((m) =>
        m.tenant.id === id ? { ...m, labServicesSuspended: true } : m
      )
    );
  }

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
    if (this.switchContext(tenantId)) {
      this.router.navigate(['/dashboard']);
    }
  }

  /**
   * Makes `tenantId` the active clinic without navigating — for links that
   * name their clinic (?clinic=…, e.g. a notification). Returns false, and
   * changes nothing, when the user isn't a member of it.
   */
  switchContext(tenantId: string): boolean {
    const clinics = this._clinics();
    const userId = this._userId();
    if (!clinics.some((m) => m.tenant.id === tenantId)) return false;
    if (this._activeTenantId() === tenantId) return true;

    this._activeTenantId.set(tenantId);
    if (userId) {
      this.saveToStorage(userId, tenantId);
    }

    this.cacheCleaners.forEach((fn) => fn());
    return true;
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
