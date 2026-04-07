import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { PatientSpecies, AgeUnit } from '@vet-ai/shared-types';
import { SpeciesIconComponent } from '../../../cases-list/components/species-icon/species-icon.component';

@Component({
  selector: 'app-case-wizard-layout',
  standalone: true,
  imports: [RouterLink, TranslatePipe, SpeciesIconComponent],
  templateUrl: './case-wizard-layout.component.html',
  styleUrl: './case-wizard-layout.component.scss',
})
export class CaseWizardLayoutComponent {
  titleKey = input<string>('');
  backRoute = input<string | any[]>('/cases');
  backLabelKey = input<string>('CASES.BACK_TO_CASES');

  patientName = input<string | undefined>(undefined);
  patientSpecies = input<PatientSpecies | undefined>(undefined);
  patientBreed = input<string | undefined>(undefined);
  patientAge = input<number | undefined>(undefined);
  patientAgeUnit = input<AgeUnit | undefined>(undefined);
  ownerName = input<string | undefined>(undefined);

  formatAge(age?: number, unit?: AgeUnit): string {
    if (age == null) return '';
    return `${age} ${unit?.toLowerCase() ?? ''}`.trim();
  }
}
