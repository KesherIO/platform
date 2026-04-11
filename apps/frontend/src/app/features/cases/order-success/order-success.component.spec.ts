import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { OrderSuccessComponent } from './order-success.component';
import { CasesService } from '../shared/services/cases.service';
import { provideTranslateService } from '@ngx-translate/core';
import { signal } from '@angular/core';

const ORDER_STATE = {
  orderId: 'ORD-1234',
  requisitionUrl: 'https://example.com/req/ORD-1234',
};

describe('OrderSuccessComponent', () => {
  let router: Router;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OrderSuccessComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({ defaultLanguage: 'en' }),
        { provide: CasesService, useValue: { activeCase: signal(null) } },
      ],
    }).compileComponents();
    router = TestBed.inject(Router);
  });

  it('creates without error', () => {
    const fixture = TestBed.createComponent(OrderSuccessComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('reads order state from navigation', () => {
    vi.spyOn(router, 'getCurrentNavigation').mockReturnValue({
      extras: { state: ORDER_STATE },
    } as unknown as ReturnType<Router['getCurrentNavigation']>);
    const fixture = TestBed.createComponent(OrderSuccessComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.orderState()?.orderId).toBe('ORD-1234');
  });
});
