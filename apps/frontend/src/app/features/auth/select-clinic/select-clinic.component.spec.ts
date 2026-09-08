import { TestBed, ComponentFixture } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { SelectClinicComponent } from './select-clinic.component';
import { AuthService } from '../../../core/services/auth.service';
import { TenantService } from '../../../core/services/tenant.service';
import { signal } from '@angular/core';

describe('SelectClinicComponent', () => {
  let fixture: ComponentFixture<SelectClinicComponent>;
  let component: SelectClinicComponent;
  let tenantService: {
    selectClinic: ReturnType<typeof vi.fn>;
    clinics: ReturnType<typeof signal>;
  };

  beforeEach(async () => {
    const clinics = signal([
      {
        role: 'VET',
        status: 'ACTIVE',
        isOrderingVet: true,
        createdAt: '',
        tenant: {
          id: 't1',
          name: 'Clinic A',
          slug: 'clinic-a',
          logoUrl: null,
          primaryColor: null,
        },
      },
      {
        role: 'ADMIN',
        status: 'ACTIVE',
        isOrderingVet: false,
        createdAt: '',
        tenant: {
          id: 't2',
          name: 'Clinic B',
          slug: 'clinic-b',
          logoUrl: null,
          primaryColor: null,
        },
      },
    ]);

    tenantService = {
      selectClinic: vi.fn(),
      clinics,
    };

    await TestBed.configureTestingModule({
      imports: [SelectClinicComponent, TranslateModule.forRoot()],
      providers: [
        { provide: AuthService, useValue: { me: signal(null) } },
        { provide: TenantService, useValue: tenantService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SelectClinicComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('creates without error', () => {
    expect(component).toBeTruthy();
  });

  it('renders a card for each clinic', () => {
    const buttons = fixture.nativeElement.querySelectorAll(
      'button[type="button"]'
    );
    expect(buttons.length).toBe(2);
  });

  it('calls selectClinic when a clinic is clicked', () => {
    const buttons = fixture.nativeElement.querySelectorAll(
      'button[type="button"]'
    );
    buttons[1].click();
    expect(tenantService.selectClinic).toHaveBeenCalledWith('t2');
  });
});
