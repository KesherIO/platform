import { ComponentFixture, TestBed } from '@angular/core/testing';
import { InputComponent } from './input.component';
import { provideTranslateService } from '@ngx-translate/core';

describe('InputComponent', () => {
  let component: InputComponent;
  let fixture: ComponentFixture<InputComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InputComponent],
      providers: [provideTranslateService({ defaultLanguage: 'en' })],
    }).compileComponents();

    fixture = TestBed.createComponent(InputComponent);
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

    it('should default type to text', () => {
      expect(component.type).toBe('text');
    });

    it('should default disabled to false', () => {
      expect(component.disabled).toBeFalse();
    });
  });

  describe('ControlValueAccessor', () => {
    it('writeValue() should set the value', () => {
      component.writeValue('test value');
      expect(component.value).toBe('test value');
    });

    it('writeValue() should set empty string for null/undefined', () => {
      component.writeValue(null as unknown as string);
      expect(component.value).toBe('');
    });

    it('registerOnChange() should store the callback', () => {
      const fn = jasmine.createSpy('onChange');
      component.registerOnChange(fn);
      component.onChange('hello');
      expect(fn).toHaveBeenCalledWith('hello');
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

      component.setDisabledState(false);
      expect(component.disabled).toBeFalse();
    });
  });

  describe('onInput()', () => {
    it('should update value and call onChange', () => {
      const fn = jasmine.createSpy('onChange');
      component.registerOnChange(fn);

      const event = { target: { value: 'new value' } } as unknown as Event;
      component.onInput(event);

      expect(component.value).toBe('new value');
      expect(fn).toHaveBeenCalledWith('new value');
    });
  });
});