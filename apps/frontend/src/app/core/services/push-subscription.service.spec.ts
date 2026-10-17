import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { signal } from '@angular/core';
import { SwPush } from '@angular/service-worker';
import { firstValueFrom, of } from 'rxjs';
import { PushSubscriptionService } from './push-subscription.service';
import { TenantService } from './tenant.service';

describe('PushSubscriptionService', () => {
  let httpMock: HttpTestingController;

  function setup(swPush: Partial<SwPush> | null) {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: TenantService, useValue: { activeTenantId: signal('t1') } },
        ...(swPush ? [{ provide: SwPush, useValue: swPush }] : []),
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    return TestBed.inject(PushSubscriptionService);
  }

  afterEach(() => httpMock.verify());

  it('creates without error and is unsupported without the service worker', () => {
    const service = setup(null);
    expect(service).toBeTruthy();
    expect(service.permission()).toBe('unsupported');
    expect(service.subscribed()).toBe(false);
  });

  it('sign-out cleanup is a no-op without the service worker', async () => {
    const service = setup({ isEnabled: false } as Partial<SwPush>);
    await expect(firstValueFrom(service.removeForSignOut())).resolves.toBe(
      undefined
    );
  });

  it('sign-out removes this browser’s subscription from the API, then unsubscribes', async () => {
    const unsubscribe = vi.fn().mockResolvedValue(undefined);
    const service = setup({
      isEnabled: true,
      subscription: of({ endpoint: 'https://push/1' } as PushSubscription),
      unsubscribe,
    } as unknown as Partial<SwPush>);

    const done = firstValueFrom(service.removeForSignOut());
    const req = httpMock.expectOne('/api/notifications/push/subscription');
    expect(req.request.method).toBe('DELETE');
    expect(req.request.body).toEqual({ endpoint: 'https://push/1' });
    req.flush({ removed: true });

    await expect(done).resolves.toBe(undefined);
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('enable subscribes with the server key and registers the subscription', async () => {
    const requestSubscription = vi.fn().mockResolvedValue({
      endpoint: 'https://push/1',
      toJSON: () => ({
        endpoint: 'https://push/1',
        keys: { p256dh: 'k', auth: 'a' },
      }),
    });
    const service = setup({
      isEnabled: true,
      subscription: of(null),
      requestSubscription,
    } as unknown as Partial<SwPush>);

    const done = firstValueFrom(service.enable(), { defaultValue: undefined });
    httpMock
      .expectOne('/api/notifications/push/public-key')
      .flush({ publicKey: 'pub' });
    await vi.waitFor(() =>
      expect(requestSubscription).toHaveBeenCalledWith({
        serverPublicKey: 'pub',
      })
    );
    const save = httpMock.expectOne('/api/notifications/push/subscription');
    expect(save.request.method).toBe('POST');
    expect(save.request.body).toEqual({
      endpoint: 'https://push/1',
      keys: { p256dh: 'k', auth: 'a' },
    });
    save.flush({ saved: true });
    await done;
  });

  it('enable fails when the server has no push key', async () => {
    const service = setup({
      isEnabled: true,
      subscription: of(null),
      requestSubscription: vi.fn(),
    } as unknown as Partial<SwPush>);

    const done = firstValueFrom(service.enable());
    httpMock
      .expectOne('/api/notifications/push/public-key')
      .flush({ publicKey: null });

    await expect(done).rejects.toThrow('Web push is not configured');
  });
});
