import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { VerificationPendingComponent } from './verification-pending.component';
import {
  VetProfileService,
  VetVerificationStatusResponse,
} from '../../../core/services/vet-profile.service';
import { AuthService } from '../../../core/services/auth.service';
import { provideTranslateService } from '@ngx-translate/core';

function makeStatus(
  status: string,
  overrides: Partial<VetVerificationStatusResponse> = {}
): VetVerificationStatusResponse {
  return {
    status,
    rejectionReason: null,
    submittedAt: '2026-09-05T00:00:00Z',
    labName: 'Biomet Lab',
    required: true,
    ...overrides,
  };
}

describe('VerificationPendingComponent', () => {
  let component: VerificationPendingComponent;
  let fixture: ComponentFixture<VerificationPendingComponent>;
  let mockVetProfileService: {
    getVerificationStatus: ReturnType<typeof vi.fn>;
  };
  let mockAuthService: {
    loadMe: ReturnType<typeof vi.fn>;
    navigateAfterAuth: ReturnType<typeof vi.fn>;
  };

  async function setup(
    statusValue: VetVerificationStatusResponse | null = makeStatus('PENDING')
  ) {
    TestBed.resetTestingModule();
    mockVetProfileService = {
      getVerificationStatus: vi.fn().mockReturnValue(of(statusValue)),
    };
    mockAuthService = {
      loadMe: vi.fn().mockReturnValue(of(undefined)),
      navigateAfterAuth: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [VerificationPendingComponent],
      providers: [
        provideTranslateService({ defaultLanguage: 'en' }),
        { provide: VetProfileService, useValue: mockVetProfileService },
        { provide: AuthService, useValue: mockAuthService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(VerificationPendingComponent);
    component = fixture.componentInstance;
  }

  it('should create', async () => {
    await setup();
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('shows status after load', async () => {
    await setup(makeStatus('PENDING', { labName: 'Biomet Lab' }));
    fixture.detectChanges();
    expect(component.status()?.labName).toBe('Biomet Lab');
    expect(component.loading()).toBe(false);
  });

  it('calls navigateAfterAuth when status is APPROVED', async () => {
    await setup(makeStatus('APPROVED'));
    fixture.detectChanges();
    expect(mockAuthService.loadMe).toHaveBeenCalled();
    expect(mockAuthService.navigateAfterAuth).toHaveBeenCalled();
  });

  it('does not navigate when status is PENDING', async () => {
    await setup(makeStatus('PENDING'));
    fixture.detectChanges();
    expect(mockAuthService.navigateAfterAuth).not.toHaveBeenCalled();
  });
});
