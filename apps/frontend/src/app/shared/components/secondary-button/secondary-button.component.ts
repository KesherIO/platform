import { Component, input } from '@angular/core';

@Component({
  selector: 'app-secondary-button',
  standalone: true,
  templateUrl: './secondary-button.component.html',
  styleUrl: './secondary-button.component.scss',
})
export class SecondaryButtonComponent {
  type = input<'button' | 'submit'>('button');
  disabled = input(false);
  fullWidth = input(true);
}
