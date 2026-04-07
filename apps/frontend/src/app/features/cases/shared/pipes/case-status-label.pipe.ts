import { Pipe, PipeTransform } from '@angular/core';
import { CaseStatus } from '@vet-ai/shared-types';

@Pipe({ name: 'caseStatusLabel', standalone: true })
export class CaseStatusLabelPipe implements PipeTransform {
  transform(status: CaseStatus): string {
    switch (status) {
      case CaseStatus.OPEN:
        return 'CASES.STATUS.OPEN';
      case CaseStatus.TRIAGED:
        return 'CASES.STATUS.TRIAGED';
      case CaseStatus.ORDERED:
        return 'CASES.STATUS.ORDERED';
      case CaseStatus.COMPLETED:
        return 'CASES.STATUS.COMPLETED';
      case CaseStatus.CANCELLED:
        return 'CASES.STATUS.CANCELLED';
    }
  }
}
