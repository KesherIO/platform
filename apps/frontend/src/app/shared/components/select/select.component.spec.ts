import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SelectComponent } from './select.component';
import { provideTranslateService } from '@ngx-translate/core';

describe('SelectComponent', () => {
  let component: SelectComponent;
  let fixture: ComponentFixture<SelectComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SelectComponent],
      providers: [provideTranslateService({ defaultLanguage: 'en' })],
    }).compileComponents();

    fixture = TestBed.createComponent(SelectComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('default inputs', () => {
    it('should default to empty value', () => {
      expect(component.value).toBe('');
    });

    it('should default placeholder to "Select an option"', () => {
      expect(component.placeholder).toBe('Select an option');
    });

    it('should default options to empty array', () => {
      expect(component.options).toEqual([]);
    });

    it('should default disabled to false', () => {
      expect(component.disabled).toBeFalse();
    });
  });

  describe('ControlValueAccessor', () => {
    it('writeValue() should set the value', () => {
      component.writeValue('option-1');
      expect(component.value).toBe('option-1');
    });

    it('writeValue() should set empty string for null/undefined', () => {
      component.writeValue(null as unknown as string);
      expect(component.value).toBe('');
    });

    it('registerOnChange() should store the callback', () => {
      const fn = jasmine.createSpy('onChangeCallback');
      component.registerOnChange(fn);
      component.onChangeCallback('selected');
      expect(fn).toHaveBeenCalledWith('selected');
    });

    it('registerOnTouched() should store the callback', () => {
      const fn = jasmine.createSpy('onTouched');
      component.registerOnTouched(fn);
      component.onTouched();
      expect(fn).toHaveBeenCalled();
    });

    it('setDisabledState() should update disabled property', () => {
      component.setDisabledState(true);
      expect(component.disabled).toBeTrue();
    });
  });

  describe('onChange()', () => {
    it('should update value and call onChangeCallback', () => {
      const fn = jasmine.createSpy('onChangeCallback');
      component.registerOnChange(fn);

      const event = { target: { value: 'feline' } } as unknown as Event;
      component.onChange(event);

      expect(component.value).toBe('feline');
      expect(fn).toHaveBeenCalledWith('feline');
    });
  });
});