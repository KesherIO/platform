import { Injectable, signal, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

const LANG_KEY = 'vetai_lang';

@Injectable({ providedIn: 'root' })
export class LanguageService {
  private translate = inject(TranslateService);

  // Initialise the signal from localStorage so it reflects the language
  // that APP_INITIALIZER already applied before the app rendered.
  currentLang = signal<'en' | 'es'>(
    (localStorage.getItem(LANG_KEY) as 'en' | 'es' | null) === 'es' ? 'es' : 'en'
  );

  setLanguage(lang: 'en' | 'es'): void {
    localStorage.setItem(LANG_KEY, lang);
    this.currentLang.set(lang);
    this.translate.use(lang);
  }
}