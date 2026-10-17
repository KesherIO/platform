import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  Router,
  RouterStateSnapshot,
  UrlTree,
} from '@angular/router';
import { signal } from '@angular/core';
import { newCaseGuard } from './new-case.guard';
import { TenantService } from '../services/tenant.service';

describe('newCaseGuard', () => {
  const casesTree = {} as UrlTree;
  let navigationState: Record<string, unknown> | undefined;

  function run(suspended: boolean) {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: TenantService,
          useValue: { labServicesSuspended: signal(suspended) },
        },
        {
          provide: Router,
          useValue: {
            getCurrentNavigation: () => ({
              extras: { state: navigationState },
            }),
            createUrlTree: vi.fn(() => casesTree),
          },
        },
      ],
    });
    return TestBed.runInInjectionContext(() =>
      newCaseGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot)
    );
  }

  beforeEach(() => {
    navigationState = undefined;
  });

  it('lets a new case through while services are active', () => {
    expect(run(false)).toBe(true);
  });

  it('sends a new case back to the cases list while suspended', () => {
    expect(run(true)).toBe(casesTree);
    expect(TestBed.inject(Router).createUrlTree).toHaveBeenCalledWith([
      '/cases',
    ]);
  });

  it('still lets an existing case be edited while suspended', () => {
    navigationState = { editCaseId: 'c1' };

    expect(run(true)).toBe(true);
  });
});
