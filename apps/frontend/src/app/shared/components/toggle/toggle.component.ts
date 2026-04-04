import { Component, Input, forwardRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'app-toggle',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => ToggleComponent),
      multi: true,
    },
  ],
  templateUrl: './toggle.component.html',
})
export class ToggleComponent implements ControlValueAccessor {
  @Input() label = '';
  @Input() options: { label: string; value: string }[] = [];
  @Input() disabled = false;

  value = '';
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  onChange: (value: string) => void = () => {};
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  onTouched: () => void = () => {};

  selectOption(optionValue: string): void {
    if (!this.disabled) {
      this.value = optionValue;
      this.onChange(this.value);
      this.onTouched();
    }
  }

  getButtonClass(optionValue: string): string {
    const baseClass =
      'px-6 py-2 rounded-full font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
    const activeClass = 'bg-black text-cyan';
    const inactiveClass = 'bg-gray-200 text-gray-600';

    return `${baseClass} ${
      this.value === optionValue ? activeClass : inactiveClass
    }`;
  }

  writeValue(value: string): void {
    this.value = value || '';
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
  }
}
