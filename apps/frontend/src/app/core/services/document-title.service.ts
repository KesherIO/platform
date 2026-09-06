import { Injectable, inject } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { TranslateService } from '@ngx-translate/core';
import { filter } from 'rxjs';

const ROUTE_TITLE_KEYS: Record<string, string> = {
  '/dashboard': 'NAV.DASHBOARD',
  '/cases': 'NAV.CASES',
  '/results': 'RESULTS_INBOX.TITLE',
  '/settings': 'NAV.SETTINGS',
};

const SUFFIX = 'Clinic · Kesher IO';

@Injectable({ providedIn: 'root' })
export class DocumentTitleService {
  private readonly router = inject(Router);
  private readonly titleService = inject(Title);
  private readonly translate = inject(TranslateService);

  init(): void {
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => {
        const url = e.urlAfterRedirects;
        const key =
          ROUTE_TITLE_KEYS[url] ??
          Object.entries(ROUTE_TITLE_KEYS).find(([prefix]) =>
            url.startsWith(prefix + '/')
          )?.[1];

        if (key) {
          const translated = this.translate.instant(key);
          this.titleService.setTitle(`${translated} · ${SUFFIX}`);
        } else {
          this.titleService.setTitle(SUFFIX);
        }
      });
  }
}
