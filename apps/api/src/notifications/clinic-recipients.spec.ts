import { clinicOrderRecipients } from './clinic-recipients';

function makeDb() {
  return {
    order: { findUnique: jest.fn() },
    userTenantMembership: { findMany: jest.fn() },
  };
}

const order = (overrides: Record<string, unknown> = {}) => ({
  tenantId: 'clinic-1',
  requisitionNumber: 'REQ-1',
  caseId: 'case-1',
  orderingVetId: 'vet-order',
  case: { attendingVetId: 'vet-attending' },
  ...overrides,
});

/** findMany answers: first the active-vet check, then the admins. */
function members(
  db: ReturnType<typeof makeDb>,
  vets: string[],
  admins: string[]
) {
  db.userTenantMembership.findMany.mockImplementation(
    ({ where }: { where: { role?: unknown } }) =>
      Promise.resolve(
        (where.role ? admins : vets).map((userId) => ({ userId }))
      )
  );
}

describe('clinicOrderRecipients', () => {
  let db: ReturnType<typeof makeDb>;
  beforeEach(() => {
    db = makeDb();
    db.order.findUnique.mockResolvedValue(order());
  });

  it('notifies the ordering and attending vets', async () => {
    members(db, ['vet-order', 'vet-attending'], ['owner-1']);

    await expect(
      clinicOrderRecipients(db as never, 'order-1')
    ).resolves.toEqual({
      tenantId: 'clinic-1',
      userIds: ['vet-order', 'vet-attending'],
      requisitionNumber: 'REQ-1',
      caseId: 'case-1',
    });
    // Admins only as a fallback
    expect(db.userTenantMembership.findMany).toHaveBeenCalledTimes(1);
    expect(db.userTenantMembership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'clinic-1',
          status: 'ACTIVE',
          userId: { in: ['vet-order', 'vet-attending'] },
        }),
      })
    );
  });

  it('counts one vet once when they both ordered and attend', async () => {
    db.order.findUnique.mockResolvedValue(
      order({ case: { attendingVetId: 'vet-order' } })
    );
    members(db, ['vet-order'], []);

    const result = await clinicOrderRecipients(db as never, 'order-1');
    expect(result?.userIds).toEqual(['vet-order']);
  });

  it('falls back to Owner/Admin when no vet is an active member', async () => {
    members(db, [], ['owner-1', 'admin-1']);

    const result = await clinicOrderRecipients(db as never, 'order-1');
    expect(result?.userIds).toEqual(['owner-1', 'admin-1']);
    expect(db.userTenantMembership.findMany).toHaveBeenLastCalledWith({
      where: {
        tenantId: 'clinic-1',
        status: 'ACTIVE',
        role: { in: ['OWNER', 'ADMIN'] },
      },
      select: { userId: true },
    });
  });

  it('adds Owner/Admin when another sample is needed, deduplicating a vet who is also admin', async () => {
    members(db, ['vet-order', 'vet-attending'], ['vet-order', 'owner-1']);

    const result = await clinicOrderRecipients(db as never, 'order-1', {
      includeAdmins: true,
    });
    expect(result?.userIds).toEqual(['vet-order', 'vet-attending', 'owner-1']);
  });

  it('returns null for an unknown order', async () => {
    db.order.findUnique.mockResolvedValue(null);
    await expect(
      clinicOrderRecipients(db as never, 'missing')
    ).resolves.toBeNull();
  });
});
