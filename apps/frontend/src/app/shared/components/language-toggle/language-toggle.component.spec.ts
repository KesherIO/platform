import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LanguageToggleComponent } from './language-toggle.component';

describe('LanguageToggleComponent', () => {
  let component: LanguageToggleComponent;
  let fixture: ComponentFixture<LanguageToggleComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LanguageToggleComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(LanguageToggleComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should default selected language to "en"', () => {
    expect(component.selected).toBe('en');
  });

  describe('selectLanguage()', () => {
    it('should update selected language', () => {
      component.selectLanguage('es');
      expect(component.selected).toBe('es');
    });

    it('should emit languageChange event with selected language', () => {
      const emittedValues: string[] = [];
      component.languageChange.subscribe((lang) => emittedValues.push(lang));

      component.selectLanguage('es');

      expect(emittedValues).toEqual(['es']);
    });

    it('should emit "en" when switching back', () => {
      const emittedValues: string[] = [];
      component.languageChange.subscribe((lang) => emittedValues.push(lang));

      component.selectLanguage('es');
      component.selectLanguage('en');

      expect(emittedValues).toEqual(['es', 'en']);
    });
  });

  describe('getButtonClass()', () => {
    it('should return active class for selected language', () => {
      component.selected = 'en';
      expect(component.getButtonClass('en')).toContain('bg-black');
      expect(component.getButtonClass('en')).toContain('text-cyan');
    });

    it('should return inactive class for non-selected language', () => {
      component.selected = 'en';
      expect(component.getButtonClass('es')).toContain('bg-gray-200');
      expect(component.getButtonClass('es')).toContain('text-gray-600');
    });

    it('should always include base classes', () => {
      const cls = component.getButtonClass('en');
      expect(cls).toContain('rounded-full');
      expect(cls).toContain('font-medium');
      expect(cls).toContain('transition-colors');
    });
  });
});