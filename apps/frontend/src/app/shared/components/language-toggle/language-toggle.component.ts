import { Component, Output, EventEmitter, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-language-toggle',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './language-toggle.component.html',
})
export class LanguageToggleComponent {
  @Input() selected: 'en' | 'es' = 'en';
  @Output() languageChange = new EventEmitter<'en' | 'es'>();

  selectLanguage(lang: 'en' | 'es'): void {
    this.selected = lang;
    this.languageChange.emit(lang);
  }

  getButtonClass(lang: 'en' | 'es'): string {
    const baseClass = 'px-6 py-2 rounded-full font-medium transition-colors';
    const activeClass = 'bg-black text-cyan';
    const inactiveClass = 'bg-gray-200 text-gray-600';

    return `${baseClass} ${this.selected === lang ? activeClass : inactiveClass}`;
  }
}
