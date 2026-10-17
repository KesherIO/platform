import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { signal } from '@angular/core';
import { LabSuspendedBannerComponent } from './lab-suspended-banner.component';
import { TenantService } from '../../../core/services/tenant.service';

describe('LabSuspendedBannerComponent', () => {
  function render(suspended: boolean) {
    TestBed.configureTestingModule({
      imports: [LabSuspendedBannerComponent, TranslateModule.forRoot()],
      providers: [
        {
          provide: TenantService,
          useValue: { labServicesSuspended: signal(suspended) },
        },
      ],
    });
    const fixture = TestBed.createComponent(LabSuspendedBannerComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('creates without error', () => {
    expect(render(false)).toBeTruthy();
  });

  it('explains the suspension while the lab has suspended services', () => {
    const el = render(true);

    expect(el.textContent).toContain('LAB_SUSPENDED.TITLE');
    expect(el.textContent).toContain('LAB_SUSPENDED.BODY');
  });

  it('shows nothing otherwise', () => {
    expect(render(false).textContent?.trim()).toBe('');
  });
});
