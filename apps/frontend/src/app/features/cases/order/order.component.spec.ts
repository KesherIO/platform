import { TestBed } from '@angular/core/testing';
import { OrderComponent } from './order.component';
import { CasesService } from '../shared/services/cases.service';
import { ActivatedRoute, Router } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
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
  };
  let routerSpy: { navigate: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    casesServiceSpy = {
      getCase: vi.fn().mockReturnValue(of(MOCK_CASE_TRIAGED)),
      createOrder: vi.fn().mockReturnValue(of(ORDER_RESULT)),
      cancelCase: vi
        .fn()
        .mockReturnValue(
          of({ ...MOCK_CASE_TRIAGED, status: CaseStatus.CANCELLED })
        ),
      activeCase: signal(null),
    };
    routerSpy = { navigate: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [OrderComponent],
      providers: [
        provideTranslateService({ defaultLanguage: 'en' }),
        { provide: CasesService, useValue: casesServiceSpy },
        { provide: Router, useValue: routerSpy },
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
    expect(casesServiceSpy.createOrder).toHaveBeenCalledWith('c2');
    expect(routerSpy.navigate).toHaveBeenCalledWith(
      ['/cases', 'c2', 'order', 'success'],
      expect.objectContaining({
        state: expect.objectContaining({ orderId: 'ORD-1234' }),
      })
    );
  });

  it('cancelCase() calls cancelCase service', () => {
    const fixture = TestBed.createComponent(OrderComponent);
    fixture.detectChanges();
    fixture.componentInstance.cancelCase();
    expect(casesServiceSpy.cancelCase).toHaveBeenCalledWith('c2');
  });
});
