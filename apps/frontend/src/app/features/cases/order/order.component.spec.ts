import { TestBed } from '@angular/core/testing';
import { OrderComponent } from './order.component';
import { CasesService } from '../shared/services/cases.service';
import { ActivatedRoute, Router } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';
import { TenantService } from '../../../core/services/tenant.service';
import { signal } from '@angular/core';
import { CaseStatus, PatientSpecies, AgeUnit } from '@vet-ai/shared-types';

const MOCK_CASE_TRIAGED = {
  id: 'c2',
  tenantId: 't1',
  status: CaseStatus.TRIAGED,
  patientName: 'Rocky',
  patientSpecies: PatientSpecies.DOG,
  patientAge: 7,
  patientAgeUnit: AgeUnit.YEARS,
  ownerName: 'Luis',
  selectedCatalogItems: [
    {
      id: 't1',
      kind: 'TEST' as const,
      code: 'CBC',
      name: 'Complete Blood Count',
      active: true,
    },
  ],
  createdByUserId: 'u1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const ORDER_RESULT = {
  orderId: 'ORD-1234',
  requisitionUrl: 'https://example.com/req/ORD-1234',
  whatsAppLink: 'https://wa.me/test',
  whatsAppMessageText: 'Lab order ORD-1234',
};

describe('OrderComponent', () => {
  let casesServiceSpy: {
    getCase: ReturnType<typeof vi.fn>;
    createOrder: ReturnType<typeof vi.fn>;
    cancelCase: ReturnType<typeof vi.fn>;
    activeCase: ReturnType<typeof signal>;
    getEligibleVets: ReturnType<typeof vi.fn>;
  };
  let routerSpy: { navigate: ReturnType<typeof vi.fn> };
  let tenantSpy: {
    labServicesSuspended: ReturnType<typeof signal<boolean>>;
    markLabServicesSuspended: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    tenantSpy = {
      labServicesSuspended: signal(false),
      markLabServicesSuspended: vi.fn(),
    };
    casesServiceSpy = {
      getCase: vi.fn().mockReturnValue(of(MOCK_CASE_TRIAGED)),
      createOrder: vi.fn().mockReturnValue(of(ORDER_RESULT)),
      cancelCase: vi
        .fn()
        .mockReturnValue(
          of({ ...MOCK_CASE_TRIAGED, status: CaseStatus.CANCELLED })
        ),
      activeCase: signal(null),
      getEligibleVets: vi.fn().mockReturnValue(of([])),
    };
    routerSpy = { navigate: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [OrderComponent],
      providers: [
        provideTranslateService({ defaultLanguage: 'en' }),
        { provide: CasesService, useValue: casesServiceSpy },
        { provide: Router, useValue: routerSpy },
        { provide: TenantService, useValue: tenantSpy },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => 'c2' } } },
        },
      ],
    }).compileComponents();
  });

  it('creates without error', () => {
    const fixture = TestBed.createComponent(OrderComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('isReadOnly is false for TRIAGED case', () => {
    const fixture = TestBed.createComponent(OrderComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.isReadOnly()).toBe(false);
  });

  it('generateRequisition() calls createOrder and navigates to success', () => {
    const fixture = TestBed.createComponent(OrderComponent);
    fixture.detectChanges();
    fixture.componentInstance.generateRequisition();
    expect(casesServiceSpy.createOrder).toHaveBeenCalledWith(
      'c2',
      'LAB_PICKUP',
      'ROUTINE',
      undefined,
      undefined
    );
    expect(routerSpy.navigate).toHaveBeenCalledWith(
      ['/cases', 'c2', 'order', 'success'],
      expect.objectContaining({
        state: expect.objectContaining({ orderId: 'ORD-1234' }),
      })
    );
  });

  it('sends the alternate location when "collect at a different address" is on', () => {
    const fixture = TestBed.createComponent(OrderComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;
    cmp.useAlternateLocation.set(true);
    cmp.altAddress.set(' Finca La Esperanza ');
    cmp.altContactName.set('Juan');
    cmp.altContactPhone.set('222');
    cmp.altNotes.set('');

    cmp.generateRequisition();

    expect(casesServiceSpy.createOrder).toHaveBeenCalledWith(
      'c2',
      'LAB_PICKUP',
      'ROUTINE',
      undefined,
      {
        address: 'Finca La Esperanza',
        contactName: 'Juan',
        contactPhone: '222',
        notes: undefined,
      }
    );
  });

  it('blocks submit until the alternate location is complete', () => {
    const fixture = TestBed.createComponent(OrderComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;
    cmp.useAlternateLocation.set(true);
    cmp.altAddress.set('Somewhere');

    expect(cmp.canSubmitOrder()).toBe(false);
    cmp.generateRequisition();
    expect(casesServiceSpy.createOrder).not.toHaveBeenCalled();
  });

  it('ignores the alternate location for client delivery', () => {
    const fixture = TestBed.createComponent(OrderComponent);
    fixture.detectChanges();
    const cmp = fixture.componentInstance;
    cmp.useAlternateLocation.set(true);
    cmp.deliveryMethod.set('CLIENT_DELIVERY');

    expect(cmp.canSubmitOrder()).toBe(true);
    cmp.generateRequisition();
    expect(casesServiceSpy.createOrder).toHaveBeenCalledWith(
      'c2',
      'CLIENT_DELIVERY',
      'ROUTINE',
      undefined,
      undefined
    );
  });

  it('cannot submit while the lab has suspended services', () => {
    tenantSpy.labServicesSuspended.set(true);
    const fixture = TestBed.createComponent(OrderComponent);
    fixture.detectChanges();

    fixture.componentInstance.generateRequisition();

    expect(fixture.componentInstance.canSubmitOrder()).toBe(false);
    expect(casesServiceSpy.createOrder).not.toHaveBeenCalled();
  });

  it('a suspension refusal mid-session turns on the shell banner', () => {
    casesServiceSpy.createOrder.mockReturnValue(
      throwError(() => ({ error: { code: 'LAB_SERVICES_SUSPENDED' } }))
    );
    const fixture = TestBed.createComponent(OrderComponent);
    fixture.detectChanges();

    fixture.componentInstance.generateRequisition();

    expect(tenantSpy.markLabServicesSuspended).toHaveBeenCalled();
    expect(fixture.componentInstance.sending()).toBe(false);
    expect(routerSpy.navigate).not.toHaveBeenCalled();
  });

  it('cancelCase() calls cancelCase service', () => {
    const fixture = TestBed.createComponent(OrderComponent);
    fixture.detectChanges();
    fixture.componentInstance.cancelCase();
    expect(casesServiceSpy.cancelCase).toHaveBeenCalledWith('c2');
  });
});
