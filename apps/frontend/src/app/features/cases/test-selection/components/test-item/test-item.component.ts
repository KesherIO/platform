import { Component, input, output } from '@angular/core';
import { CatalogItemModel } from '@vet-ai/shared-types';

@Component({
  selector: 'app-test-item',
  standalone: true,
  imports: [],
  templateUrl: './test-item.component.html',
  styleUrl: './test-item.component.scss',
})
export class TestItemComponent {
  item = input.required<CatalogItemModel>();
  selected = input.required<boolean>();
  suggested = input<boolean>(false);

  toggled = output<void>();
}
