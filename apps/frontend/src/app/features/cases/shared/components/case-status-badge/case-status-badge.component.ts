import { Component, input } from '@angular/core';
import { CaseStatus } from '@vet-ai/shared-types';
import { TranslatePipe } from '@ngx-translate/core';
import { CaseStatusLabelPipe } from '../../pipes/case-status-label.pipe';

@Component({
  selector: 'app-case-status-badge',
  standalone: true,
  imports: [TranslatePipe, CaseStatusLabelPipe],
  templateUrl: './case-status-badge.component.html',
  styleUrl: './case-status-badge.component.scss',
})
export class CaseStatusBadgeComponent {
  status = input.required<CaseStatus>();

  get color(): string {
    switch (this.status()) {
      case CaseStatus.OPEN:
        return '#29B8BE';
      case CaseStatus.TRIAGED:
        return '#A65AF4';
      case CaseStatus.ORDERED:
        return '#38A8E0';
      case CaseStatus.COMPLETED:
        return '#1ECC83';
      case CaseStatus.CANCELLED:
        return '#9CA3AF';
    }
  }
}
