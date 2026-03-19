import { Injectable, signal, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

@Injectable({ providedIn: 'root' })
export class LanguageService {
  private translate = inject(TranslateService);

  currentLang = signal<'en' | 'es'>('en');

  constructor() {
    this.translate.setDefaultLang('en');
    this.translate.use('en');
  }

  setLanguage(lang: 'en' | 'es'): void {
    this.currentLang.set(lang);
    this.translate.use(lang);
  }
}