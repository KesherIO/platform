import { Component, input } from '@angular/core';

@Component({
  selector: 'app-outline-button',
  standalone: true,
  templateUrl: './outline-button.component.html',
  styleUrl: './outline-button.component.scss',
})
export class OutlineButtonComponent {
  type = input<'button' | 'submit'>('button');
  disabled = input(false);
  fullWidth = input(true);
}
