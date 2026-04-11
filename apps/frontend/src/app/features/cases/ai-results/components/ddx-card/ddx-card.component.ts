import { Component, input, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { DiagnosisModel } from '@vet-ai/shared-types';

@Component({
  selector: 'app-ddx-card',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './ddx-card.component.html',
  styleUrl: './ddx-card.component.scss',
})
export class DdxCardComponent {
  diagnosis = input.required<DiagnosisModel>();

  expanded = signal(false);

  toggle(): void {
    this.expanded.update((v) => !v);
  }
}
