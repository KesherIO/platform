import type { NotificationType } from '@prisma/client';
import {
  activeMemberIds,
  isRecipientStillAuthorized,
} from './notification-access';

function makeDb() {
  return {
    userTenantMembership: { findMany: jest.fn(), findUnique: jest.fn() },
    order: { findUnique: jest.fn() },
    pickup: { findUnique: jest.fn() },
    laboratoryProfile: { findUnique: jest.fn() },
  };
}

const member = (overrides: Record<string, unknown> = {}) => ({
  status: 'ACTIVE',
  role: 'VET',
  canPerformPickups: false,
  tenant: { type: 'CLINIC' },
  ...overrides,
});

const notification = (
  type: NotificationType,
  overrides: Record<string, unknown> = {}
) => ({
  recipientUserId: 'user-1',
  tenantId: 'clinic-1',
  type,
  orderId: 'order-1',
  pickupId: null,
  params: {},
  ...overrides,
});

describe('notification access', () => {
  let db: ReturnType<typeof makeDb>;
  beforeEach(() => {
    db = makeDb();
  });

  describe('activeMemberIds', () => {
    it('keeps only ACTIVE members of the tenant', async () => {
      db.userTenantMembership.findMany.mockResolvedValue([{ userId: 'u-1' }]);

      await expect(
        activeMemberIds(db as never, 'clinic-1', ['u-1', 'u-2'])
      ).resolves.toEqual(['u-1']);
      expect(db.userTenantMembership.findMany).toHaveBeenCalledWith({
        where: {
          tenantId: 'clinic-1',
          userId: { in: ['u-1', 'u-2'] },
          status: 'ACTIVE',
        },
        select: { userId: true },
      });
    });

    it('skips the query when there is nobody to check', async () => {
      await expect(activeMemberIds(db as never, 'c', [])).resolves.toEqual([]);
      expect(db.userTenantMembership.findMany).not.toHaveBeenCalled();
    });
  });

  describe('isRecipientStillAuthorized', () => {
    it.each(['VERIFICATION_PENDING', 'SUSPENDED', 'PROFILE_REQUIRED'])(
      'refuses a %s member',
      async (status) => {
        db.userTenantMembership.findUnique.mockResolvedValue(
          member({ status })
        );
        await expect(
          isRecipientStillAuthorized(
            db as never,
            notification('RESULTS_RELEASED')
          )
        ).resolves.toBe(false);
      }
    );

    it('refuses someone who left the clinic', async () => {
      db.userTenantMembership.findUnique.mockResolvedValue(null);
      await expect(
        isRecipientStillAuthorized(db as never, notification('TESTS_ADDED'))
      ).resolves.toBe(false);
    });

    it('allows an active member of the clinic that owns the order', async () => {
      db.userTenantMembership.findUnique.mockResolvedValue(member());
      db.order.findUnique.mockResolvedValue({
        tenantId: 'clinic-1',
        labTenantId: 'lab-1',
      });
      await expect(
        isRecipientStillAuthorized(
          db as never,
          notification('RESULTS_RELEASED')
        )
      ).resolves.toBe(true);
    });

    it('refuses when the order belongs to another clinic', async () => {
      db.userTenantMembership.findUnique.mockResolvedValue(member());
      db.order.findUnique.mockResolvedValue({
        tenantId: 'clinic-2',
        labTenantId: 'lab-1',
      });
      await expect(
        isRecipientStillAuthorized(db as never, notification('TESTS_ADDED'))
      ).resolves.toBe(false);
    });

    it('drops an amendment push once the lab made amendments silent', async () => {
      db.userTenantMembership.findUnique.mockResolvedValue(member());
      db.order.findUnique.mockResolvedValue({
        tenantId: 'clinic-1',
        labTenantId: 'lab-1',
      });
      db.laboratoryProfile.findUnique.mockResolvedValue({
        showAmendmentsToClinic: false,
      });
      await expect(
        isRecipientStillAuthorized(db as never, notification('RESULTS_AMENDED'))
      ).resolves.toBe(false);
    });

    describe('PICKUP_ASSIGNED', () => {
      const assignedAt = new Date('2026-10-18T08:00:00Z');
      const pickupNotification = notification('PICKUP_ASSIGNED', {
        tenantId: 'lab-1',
        pickupId: 'pickup-1',
        params: { assignedAt: assignedAt.toISOString() },
      });

      beforeEach(() => {
        db.userTenantMembership.findUnique.mockResolvedValue(
          member({ role: 'MESSENGER', tenant: { type: 'LAB' } })
        );
      });

      it('allows the messenger the pickup is still assigned to', async () => {
        db.pickup.findUnique.mockResolvedValue({
          messengerId: 'user-1',
          assignedAt,
          status: 'NOTIFIED',
        });
        await expect(
          isRecipientStillAuthorized(db as never, pickupNotification)
        ).resolves.toBe(true);
      });

      it('refuses after the pickup was reassigned (new assignment)', async () => {
        db.pickup.findUnique.mockResolvedValue({
          messengerId: 'user-1',
          assignedAt: new Date('2026-10-18T09:00:00Z'),
          status: 'ASSIGNED',
        });
        await expect(
          isRecipientStillAuthorized(db as never, pickupNotification)
        ).resolves.toBe(false);
      });

      it('refuses after the pickup moved to another messenger', async () => {
        db.pickup.findUnique.mockResolvedValue({
          messengerId: 'user-2',
          assignedAt,
          status: 'ASSIGNED',
        });
        await expect(
          isRecipientStillAuthorized(db as never, pickupNotification)
        ).resolves.toBe(false);
      });

      it('refuses once the pickup is cancelled', async () => {
        db.pickup.findUnique.mockResolvedValue({
          messengerId: 'user-1',
          assignedAt,
          status: 'CANCELLED',
        });
        await expect(
          isRecipientStillAuthorized(db as never, pickupNotification)
        ).resolves.toBe(false);
      });

      it('refuses a member who can no longer do pickups', async () => {
        db.userTenantMembership.findUnique.mockResolvedValue(
          member({ role: 'ANALYST', tenant: { type: 'LAB' } })
        );
        await expect(
          isRecipientStillAuthorized(db as never, pickupNotification)
        ).resolves.toBe(false);
        expect(db.pickup.findUnique).not.toHaveBeenCalled();
      });
    });

    it('a pickup cancellation only needs an active lab membership', async () => {
      db.userTenantMembership.findUnique.mockResolvedValue(
        member({ role: 'MESSENGER', tenant: { type: 'LAB' } })
      );
      await expect(
        isRecipientStillAuthorized(
          db as never,
          notification('PICKUP_CANCELLED', { tenantId: 'lab-1' })
        )
      ).resolves.toBe(true);
    });

    it('never sends a clinic notification to a lab membership', async () => {
      db.userTenantMembership.findUnique.mockResolvedValue(
        member({ tenant: { type: 'LAB' } })
      );
      await expect(
        isRecipientStillAuthorized(db as never, notification('TESTS_ADDED'))
      ).resolves.toBe(false);
    });
  });
});
