import { TestBed } from '@angular/core/testing';
import { LanguageService } from './language.service';
import {  provideTranslateService } from '@ngx-translate/core';

describe('LanguageService', () => {
  let service: LanguageService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideTranslateService({ defaultLanguage: 'en' })],
    });
    service = TestBed.inject(LanguageService);
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
  });
});