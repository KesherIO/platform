import { Component, inject } from '@angular/core';

import { RouterModule } from '@angular/router';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';

@Component({
    selector: 'app-case-form',
    imports: [RouterModule, FormsModule, ReactiveFormsModule],
  templateUrl: './case-form.component.html',
})
export class CaseFormComponent {
  private fb = inject(FormBuilder);

  caseForm: FormGroup;

  constructor() {
    this.caseForm = this.fb.group({
      ownerName: ['', Validators.required],
      ownerPhone: ['', Validators.required],
      ownerEmail: [''],
      patientName: ['', Validators.required],
      species: ['', Validators.required],
      sex: ['', Validators.required],
      ageMonths: ['', [Validators.required, Validators.min(0)]],
      weightKg: ['', [Validators.required, Validators.min(0)]],
      breed: [''],
      chiefComplaint: ['']
    });
  }

  onSubmit() {
    if (this.caseForm.valid) {
      console.log('Form submitted:', this.caseForm.value);
      // TODO: Submit to service and navigate to case detail
    }
  }
}
