import 'reflect-metadata';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from '../auth/decorators/public.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { LabTenantGuard } from '../lab/lab-tenant.guard';
import { ConnectorAuthGuard } from './connector-auth.guard';
import { InstrumentIngestController } from './instrument-ingest.controller';
import { InstrumentReviewController } from './instrument-review.controller';
import type { ConnectorCredentialService } from './connector-credential.service';
import type { InstrumentReviewService } from './instrument-review.service';
import type { TenantContext, AuthenticatedUser } from '@vet-ai/shared-types';

describe('instrument controllers: who can call what', () => {
  it('the connector route is public to the JWT guard but protected by the connector credential guard', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, InstrumentIngestController)).toBe(true);
    expect(Reflect.getMetadata(GUARDS_METADATA, InstrumentIngestController)).toEqual([ConnectorAuthGuard]);
    expect(Reflect.getMetadata(PATH_METADATA, InstrumentIngestController)).toBe('instrument-ingest');
  });

  it('every staff route requires a Supabase user + lab membership, and none is public', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, InstrumentReviewController)).toBeUndefined();
    expect(Reflect.getMetadata(GUARDS_METADATA, InstrumentReviewController)).toEqual([JwtAuthGuard, LabTenantGuard]);
    for (const name of Object.getOwnPropertyNames(InstrumentReviewController.prototype)) {
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, InstrumentReviewController.prototype[name as keyof InstrumentReviewController])).toBeUndefined();
    }
  });
});

describe('InstrumentReviewController', () => {
  const review = {
    summary: jest.fn(), list: jest.fn(), get: jest.fn(), resolveSample: jest.fn(), approve: jest.fn(), dismiss: jest.fn(), createLink: jest.fn(),
  };
  const credentials = { create: jest.fn(), revoke: jest.fn(), list: jest.fn() };
  const controller = new InstrumentReviewController(review as unknown as InstrumentReviewService, credentials as unknown as ConnectorCredentialService);
  const tenant = { tenantId: 'lab1' } as TenantContext;
  const user = { id: 'u1', email: 'a@b.c', firstName: 'Ana', lastName: 'Ruiz' } as AuthenticatedUser;
  beforeEach(() => jest.resetAllMocks());

  it('always passes the tenant from the guard, never from the request', () => {
    controller.summary(tenant);
    controller.get(tenant, 'm1');
    expect(review.summary).toHaveBeenCalledWith('lab1');
    expect(review.get).toHaveBeenCalledWith('lab1', 'm1');
  });

  it('falls back to the default view for an unknown ?view', () => {
    controller.list(tenant, 'bogus');
    expect(review.list).toHaveBeenCalledWith('lab1', 'attention', undefined, undefined);
  });

  it('approve records the reviewer by id and full name', () => {
    controller.approve(tenant, user, 'm1', { reasons: ['CONTENT_CHANGED'], note: 'ok' });
    expect(review.approve).toHaveBeenCalledWith('lab1', 'm1', { id: 'u1', name: 'Ana Ruiz' }, ['CONTENT_CHANGED'], 'ok');
  });

  it('credential create/revoke are attributed to the signed-in user', () => {
    controller.createCredential(tenant, user, { analyzerId: 'an1', name: 'PC' });
    controller.revokeCredential(tenant, user, 'c1');
    expect(credentials.create).toHaveBeenCalledWith('lab1', 'an1', 'PC', 'u1');
    expect(credentials.revoke).toHaveBeenCalledWith('lab1', 'c1', 'u1');
  });
});
