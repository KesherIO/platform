import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { signal } from '@angular/core';
import { VetProfileComponent } from './vet-profile.component';
import { VetProfileService } from '../../../core/services/vet-profile.service';
import { AuthService } from '../../../core/services/auth.service';
import { provideTranslateService } from '@ngx-translate/core';
import { VeterinarianProfileModel } from '@vet-ai/shared-types';

const PROFILE_STUB: VeterinarianProfileModel = {
  id: 'profile-1',
  userId: 'user-1',
  legalName: 'Dr. Jane Doe',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  activeCredential: {
    id: 'cred-1',
    veterinarianProfileId: 'profile-1',
    documentKey: 'vet-credentials/user-1/cred-1.pdf',
    licenseNumber: 'MVZ-123',
    issuingCountry: 'MX',
    issuingAuthority: 'SENASICA',
    licenseExpiresAt: '2027-12-31T00:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
    replacedAt: null,
  },
};

describe('VetProfileComponent', () => {
  let component: VetProfileComponent;
  let fixture: ComponentFixture<VetProfileComponent>;
  let mockVetProfileService: {
    getProfile: ReturnType<typeof vi.fn>;
    createProfile: ReturnType<typeof vi.fn>;
    updateProfile: ReturnType<typeof vi.fn>;
    uploadCredential: ReturnType<typeof vi.fn>;
    submitVerification: ReturnType<typeof vi.fn>;
  };
  let mockRouter: { navigate: ReturnType<typeof vi.fn> };
  let mockAuthService: {
    me: ReturnType<typeof signal>;
    loadMe: ReturnType<typeof vi.fn>;
  };

  async function setup(
    options: { mode?: string; profileExists?: boolean } = {}
  ) {
    TestBed.resetTestingModule();
    mockVetProfileService = {
      getProfile: vi.fn(),
      createProfile: vi.fn(),
      updateProfile: vi.fn(),
      uploadCredential: vi.fn(),
      submitVerification: vi.fn(),
    };
    mockRouter = { navigate: vi.fn() };
    mockAuthService = { me: signal({ userId: 'user-1' }), loadMe: vi.fn() };

    if (options.profileExists) {
      mockVetProfileService.getProfile.mockReturnValue(of(PROFILE_STUB));
    } else {
      mockVetProfileService.getProfile.mockReturnValue(
        throwError(() => ({ status: 404 }))
      );
    }

    await TestBed.configureTestingModule({
      imports: [VetProfileComponent],
      providers: [
        provideTranslateService({ defaultLanguage: 'en' }),
        { provide: VetProfileService, useValue: mockVetProfileService },
        { provide: AuthService, useValue: mockAuthService },
        { provide: Router, useValue: mockRouter },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              queryParamMap: {
                get: (k: string) =>
                  k === 'mode' ? options.mode ?? null : null,
              },
            },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(VetProfileComponent);
    component = fixture.componentInstance;
  }

  it('should create', async () => {
    await setup();
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  describe('create mode — no existing profile', () => {
    beforeEach(async () => setup({ profileExists: false }));

    it('sets viewState to form after 404', () => {
      fixture.detectChanges();
      expect(component.viewState()).toBe('form');
    });

    it('sets mode to create by default', () => {
      fixture.detectChanges();
      expect(component.mode()).toBe('create');
    });

    it('transitions to ready-to-submit after successful save without file', () => {
      fixture.detectChanges();
      mockVetProfileService.createProfile.mockReturnValue(
        of({ id: 'p1', legalName: 'Dr. Test' })
      );

      component.form.patchValue({
        legalName: 'Dr. Test',
        licenseNumber: 'LIC-1',
        issuingCountry: 'MX',
      });
      // Simulate existing doc so isSaveDisabled is false
      component.hasExistingDoc.set(true);
      component.onSave();

      expect(component.viewState()).toBe('ready-to-submit');
    });

    it('navigates to verification-pending on submit for review', () => {
      fixture.detectChanges();
      mockVetProfileService.createProfile.mockReturnValue(
        of({ id: 'p1', legalName: 'Dr. Test' })
      );
      mockVetProfileService.submitVerification.mockReturnValue(
        of({
          verificationId: 'v1',
          status: 'PENDING',
          submittedAt: '2026-09-05T00:00:00Z',
        })
      );

      component.form.patchValue({
        legalName: 'Dr. Test',
        licenseNumber: 'LIC-1',
        issuingCountry: 'MX',
      });
      component.hasExistingDoc.set(true);
      component.onSave();
      component.onSubmitForReview();

      expect(mockRouter.navigate).toHaveBeenCalledWith([
        '/onboarding/verification-pending',
      ]);
    });
  });

  describe('edit mode — existing profile', () => {
    beforeEach(async () => setup({ mode: 'edit', profileExists: true }));

    it('sets mode to edit', () => {
      fixture.detectChanges();
      expect(component.mode()).toBe('edit');
    });

    it('prefills form from existing profile', () => {
      fixture.detectChanges();
      expect(component.form.value.legalName).toBe('Dr. Jane Doe');
      expect(component.form.value.licenseNumber).toBe('MVZ-123');
    });

    it('saves and submits directly then navigates to verification-pending', () => {
      fixture.detectChanges();
      mockVetProfileService.updateProfile.mockReturnValue(of(PROFILE_STUB));
      mockVetProfileService.submitVerification.mockReturnValue(
        of({
          verificationId: 'v1',
          status: 'PENDING',
          submittedAt: '2026-09-05T00:00:00Z',
        })
      );

      component.onSave();

      expect(mockRouter.navigate).toHaveBeenCalledWith([
        '/onboarding/verification-pending',
      ]);
    });
  });

  describe('document validation', () => {
    beforeEach(async () => setup({ profileExists: false }));

    it('rejects invalid file type', () => {
      fixture.detectChanges();
      const file = new File(['data'], 'doc.txt', { type: 'text/plain' });
      const event = { target: { files: [file] } } as unknown as Event;
      component.onDocFileChange(event);
      expect(component.docError()).toBe('VET_PROFILE.DOCUMENT_TYPE_ERROR');
    });

    it('rejects oversized file', () => {
      fixture.detectChanges();
      const big = new File([new ArrayBuffer(11 * 1024 * 1024)], 'big.pdf', {
        type: 'application/pdf',
      });
      const event = { target: { files: [big] } } as unknown as Event;
      component.onDocFileChange(event);
      expect(component.docError()).toBe('VET_PROFILE.DOCUMENT_SIZE_ERROR');
    });
  });
});
