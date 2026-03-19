import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ToggleComponent } from './toggle.component';
import { provideTranslateService } from '@ngx-translate/core';

describe('ToggleComponent', () => {
  let component: ToggleComponent;
  let fixture: ComponentFixture<ToggleComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ToggleComponent],
      providers: [provideTranslateService({ defaultLanguage: 'en' })],
    }).compileComponents();

    fixture = TestBed.createComponent(ToggleComponent);
    component = fixture.componentInstance;
    component.options = [
      { label: 'Option A', value: 'a' },
      { label: 'Option B', value: 'b' },
    ];
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('selectOption()', () => {
    it('should update value when enabled', () => {
      component.selectOption('a');
      expect(component.value).toBe('a');
    });

    it('should call onChange with new value', () => {
      const fn = jasmine.createSpy('onChange');
      component.registerOnChange(fn);
      component.selectOption('b');
      expect(fn).toHaveBeenCalledWith('b');
    });

    it('should call onTouched when option is selected', () => {
      const fn = jasmine.createSpy('onTouched');
      component.registerOnTouched(fn);
      component.selectOption('a');
      expect(fn).toHaveBeenCalled();
    });

    it('should not update value when disabled', () => {
      component.disabled = true;
      component.selectOption('a');
      expect(component.value).toBe('');
    });
  });

  describe('getButtonClass()', () => {
    it('should return active class for selected option', () => {
      component.value = 'a';
      expect(component.getButtonClass('a')).toContain('bg-black');
      expect(component.getButtonClass('a')).toContain('text-cyan');
    });

    it('should return inactive class for non-selected option', () => {
      component.value = 'a';
      expect(component.getButtonClass('b')).toContain('bg-gray-200');
      expect(component.getButtonClass('b')).toContain('text-gray-600');
    });

    it('should always include base classes', () => {
      const cls = component.getButtonClass('a');
      expect(cls).toContain('rounded-full');
      expect(cls).toContain('font-medium');
      expect(cls).toContain('transition-colors');
    });
  });

  describe('ControlValueAccessor', () => {
    it('writeValue() should set value', () => {
      component.writeValue('b');
      expect(component.value).toBe('b');
    });

    it('setDisabledState() should update disabled', () => {
      component.setDisabledState(true);
      expect(component.disabled).toBeTrue();
    });
  });
});