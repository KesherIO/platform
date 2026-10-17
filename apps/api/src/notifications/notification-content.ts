import type { NotificationType } from '@prisma/client';
import type { NotificationParams } from '@vet-ai/shared-types';

/** Which web app a notification type opens in. */
export function notificationApp(type: NotificationType): 'LAB' | 'CLINIC' {
  return type.startsWith('PICKUP_') ? 'LAB' : 'CLINIC';
}

/**
 * In-app path a notification opens. Clinic links carry the clinic so a user
 * of several clinics lands in the right one.
 */
export function notificationLink(
  type: NotificationType,
  tenantId: string,
  params: NotificationParams
): string {
  if (notificationApp(type) === 'LAB') return '/my-pickups';
  return params.caseId
    ? `/cases/${params.caseId}/report?clinic=${encodeURIComponent(tenantId)}`
    : `/dashboard?clinic=${encodeURIComponent(tenantId)}`;
}

/**
 * Push preview text — Spanish only for v1 (users have no stored language).
 * The requisition number and a short message only: never patient names or
 * result values, which may show on a lock screen.
 */
export function pushText(
  type: NotificationType,
  params: NotificationParams
): { title: string; body: string } {
  const req = params.requisitionNumber ?? '';
  switch (type) {
    case 'TESTS_ADDED':
      return {
        title: 'Pruebas agregadas',
        body: params.sampleRequired
          ? `${req}: se agregaron pruebas. Se requiere una nueva muestra.`
          : `${req}: el laboratorio agregó pruebas a la orden.`,
      };
    case 'ADDITIONAL_SAMPLE_REQUIRED':
      return {
        title: 'Se requiere una nueva muestra',
        body: `${req}: el laboratorio necesita otra muestra.`,
      };
    case 'RESULTS_RELEASED':
      return {
        title: 'Resultados disponibles',
        body:
          params.releaseType === 'FINAL'
            ? `${req}: los resultados están completos.`
            : `${req}: hay resultados parciales disponibles.`,
      };
    case 'RESULTS_AMENDED':
      return {
        title: 'Resultados corregidos',
        body: `${req}: el laboratorio corrigió resultados.`,
      };
    case 'PICKUP_ASSIGNED':
      return {
        title: 'Nueva recolección asignada',
        body: `${req} — toca para ver los detalles.`,
      };
    case 'PICKUP_UNASSIGNED':
      return {
        title: 'Recolección reasignada',
        body: `${req} ya no está asignada a ti.`,
      };
    case 'PICKUP_CANCELLED':
      return {
        title: 'Recolección cancelada',
        body: `${req} fue cancelada.`,
      };
  }
}

/**
 * Device-level grouping: a newer push with the same tag replaces the older
 * one, so results for one order (or a resent push) never stack up.
 */
export function pushTag(
  type: NotificationType,
  orderId: string | null,
  pickupId: string | null,
  notificationId: string
): string {
  if (type.startsWith('PICKUP_') && pickupId) return `pickup:${pickupId}`;
  if (orderId) return `order:${orderId}`;
  return `notification:${notificationId}`;
}
