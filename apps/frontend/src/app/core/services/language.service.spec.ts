import { TestBed } from '@angular/core/testing';
import { LanguageService } from './language.service';
import { TranslateService } from '@ngx-translate/core';
import { provideTranslateService } from '@ngx-translate/core';

describe('LanguageService', () => {
  let service: LanguageService;
  let translateService: TranslateService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideTranslateService({ defaultLanguage: 'en' })],
    });
    service = TestBed.inject(LanguageService);
    translateService = TestBed.inject(TranslateService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should default to English', () => {
    expect(service.currentLang()).toBe('en');
  });

  describe('setLanguage()', () => {
    it('should update currentLang signal to Spanish', () => {
      service.setLanguage('es');
      expect(service.currentLang()).toBe('es');
    });

    it('should update currentLang signal back to English', () => {
      service.setLanguage('es');
      service.setLanguage('en');
      expect(service.currentLang()).toBe('en');
    });

    it('should call TranslateService.use() with the selected language', () => {
      spyOn(translateService, 'use').and.callThrough();
      service.setLanguage('es');
      expect(translateService.use).toHaveBeenCalledWith('es');
    });
  });
});