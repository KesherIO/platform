import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-button',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './button.component.html',
})
export class ButtonComponent {
  @Input() type: 'button' | 'submit' = 'button';
  @Input() variant: 'primary' | 'secondary' | 'gradient' = 'primary';
  @Input() disabled = false;
  @Input() fullWidth = true;

  getButtonClass(): string {
    const baseClass = 'px-6 py-3 rounded-full font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed';
    const widthClass = this.fullWidth ? 'w-full' : '';

    let variantClass = '';
    if (this.variant === 'primary') {
      variantClass = 'bg-black text-cyan hover:bg-gray-900';
    } else if (this.variant === 'secondary') {
      variantClass = 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50';
    } else if (this.variant === 'gradient') {
      variantClass = 'bg-gradient-to-r from-purple-dark to-purple text-white hover:from-purple to-purple-light';
    }

    return `${baseClass} ${widthClass} ${variantClass}`;
  }
}
