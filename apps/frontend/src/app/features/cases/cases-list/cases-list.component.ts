import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { CaseModel } from '../../../core/models';

@Component({
  selector: 'app-cases-list',
  imports: [CommonModule, RouterModule],
  templateUrl: './cases-list.component.html',
})
export class CasesListComponent {
  cases: CaseModel[] = [];

  constructor() {
    // TODO: Load cases from service
  }
}
