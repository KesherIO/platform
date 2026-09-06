import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { VerificationRejectedComponent } from './verification-rejected.component';
import {
  VetProfileService,
  VetVerificationStatusResponse,
} from '../../../core/services/vet-profile.service';
import { provideTranslateService } from '@ngx-translate/core';

function makeStatus(
  overrides: Partial<VetVerificationStatusResponse> = {}
): VetVerificationStatusResponse {
  return {
    status: 'REJECTED',
    rejectionReason: 'License number not found in registry.',
    submittedAt: '2026-09-05T00:00:00Z',
    labName: 'Biomet Lab',
    required: true,
    ...overrides,
  };
}

describe('VerificationRejectedComponent', () => {
  let component: VerificationRejectedComponent;
  let fixture: ComponentFixture<VerificationRejectedComponent>;
  let mockVetProfileService: {
    getVerificationStatus: ReturnType<typeof vi.fn>;
  };
  let mockRouter: { navigate: ReturnType<typeof vi.fn> };

  async function setup(
    statusValue: VetVerificationStatusResponse | null = makeStatus()
  ) {
    TestBed.resetTestingModule();
    mockVetProfileService = {
      getVerificationStatus: vi.fn().mockReturnValue(of(statusValue)),
    };
    mockRouter = { navigate: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [VerificationRejectedComponent],
      providers: [
        provideTranslateService({ defaultLanguage: 'en' }),
        { provide: VetProfileService, useValue: mockVetProfileService },
        { provide: Router, useValue: mockRouter },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(VerificationRejectedComponent);
    component = fixture.componentInstance;
  }

  it('should create', async () => {
    await setup();
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('loads and displays rejection reason', async () => {
    await setup(
      makeStatus({ rejectionReason: 'License number not found in registry.' })
    );
    fixture.detectChanges();
    expect(component.status()?.rejectionReason).toBe(
      'License number not found in registry.'
    );
    expect(component.loading()).toBe(false);
  });

  it('onUpdateCredentials navigates to vet-profile in edit mode', async () => {
    await setup();
    fixture.detectChanges();
    component.onUpdateCredentials();
    expect(mockRouter.navigate).toHaveBeenCalledWith(
      ['/onboarding/vet-profile'],
      { queryParams: { mode: 'edit' } }
    );
  });

  it('shows null rejectionReason gracefully', async () => {
    await setup(makeStatus({ rejectionReason: null }));
    fixture.detectChanges();
    expect(component.status()?.rejectionReason).toBeNull();
  });
});
