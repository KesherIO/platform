import { Component, input } from '@angular/core';
import { PatientSpecies } from '@vet-ai/shared-types';

@Component({
  selector: 'app-species-icon',
  standalone: true,
  imports: [],
  templateUrl: './species-icon.component.html',
  styleUrl: './species-icon.component.scss',
})
export class SpeciesIconComponent {
  species = input.required<PatientSpecies>();

  get iconSrc(): string {
    switch (this.species()) {
      case PatientSpecies.DOG:
        return 'assets/icons/dog.png';
      case PatientSpecies.CAT:
        return 'assets/icons/cat.png';
      case PatientSpecies.EQUINE:
        return 'assets/icons/equine.png';
      case PatientSpecies.BOVINE:
        return 'assets/icons/bovine.png';
      case PatientSpecies.BIRD:
        return 'assets/icons/bird.png';
      case PatientSpecies.REPTILE:
        return 'assets/icons/reptile.png';
      case PatientSpecies.RABBIT:
        return 'assets/icons/rabbit.png';
      default:
        return 'assets/icons/other.png';
    }
  }
}
