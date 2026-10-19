import type { NotificationType } from '@prisma/client';
import {
  notificationApp,
  notificationLink,
  pushTag,
  pushText,
} from './notification-content';

const ALL_TYPES: NotificationType[] = [
  'TESTS_ADDED',
  'ADDITIONAL_SAMPLE_REQUIRED',
  'RESULTS_RELEASED',
  'RESULTS_AMENDED',
  'PICKUP_ASSIGNED',
  'PICKUP_UNASSIGNED',
  'PICKUP_CANCELLED',
];

describe('notification content', () => {
  it('pickup notifications open in the lab app, the rest in the clinic app', () => {
    expect(notificationApp('PICKUP_ASSIGNED')).toBe('LAB');
    expect(notificationApp('PICKUP_CANCELLED')).toBe('LAB');
    expect(notificationApp('RESULTS_RELEASED')).toBe('CLINIC');
    expect(notificationApp('TESTS_ADDED')).toBe('CLINIC');
  });

  it('clinic links open the case report in that clinic', () => {
    expect(
      notificationLink('RESULTS_RELEASED', 'clinic-1', { caseId: 'case-9' })
    ).toBe('/cases/case-9/report?clinic=clinic-1');
    expect(notificationLink('TESTS_ADDED', 'clinic-1', {})).toBe(
      '/dashboard?clinic=clinic-1'
    );
    expect(notificationLink('PICKUP_ASSIGNED', 'lab-1', {})).toBe(
      '/my-pickups'
    );
  });

  it.each(ALL_TYPES)(
    '%s push text carries the requisition number only',
    (type) => {
      const { title, body } = pushText(type, {
        requisitionNumber: 'REQ-2026-000042',
        testNames: ['Hemograma'],
        caseId: 'case-1',
      });
      expect(title.length).toBeGreaterThan(0);
      expect(body).toContain('REQ-2026-000042');
      // Test names, ids and anything patient-related stay inside the app
      expect(`${title} ${body}`).not.toContain('Hemograma');
      expect(`${title} ${body}`).not.toContain('case-1');
    }
  );

  it('says tests were added, another sample is needed, results are complete', () => {
    expect(pushText('TESTS_ADDED', { requisitionNumber: 'R' }).body).toContain(
      'agregó pruebas'
    );
    expect(
      pushText('ADDITIONAL_SAMPLE_REQUIRED', { requisitionNumber: 'R' }).body
    ).toContain('otra muestra');
    expect(
      pushText('RESULTS_RELEASED', {
        requisitionNumber: 'R',
        releaseType: 'FINAL',
      }).body
    ).toContain('completos');
    expect(
      pushText('RESULTS_RELEASED', {
        requisitionNumber: 'R',
        releaseType: 'PARTIAL',
      }).body
    ).toContain('parciales');
  });

  it('tags by pickup, then order, then the notification itself', () => {
    expect(pushTag('PICKUP_ASSIGNED', 'o-1', 'p-1', 'n-1')).toBe('pickup:p-1');
    expect(pushTag('RESULTS_RELEASED', 'o-1', null, 'n-1')).toBe('order:o-1');
    expect(pushTag('RESULTS_RELEASED', null, null, 'n-1')).toBe(
      'notification:n-1'
    );
  });
});
