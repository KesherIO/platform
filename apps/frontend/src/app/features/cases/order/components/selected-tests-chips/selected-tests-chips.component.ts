import { Component, input, computed } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { CatalogItemModel } from '@vet-ai/shared-types';

@Component({
  selector: 'app-selected-tests-chips',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './selected-tests-chips.component.html',
  styleUrl: './selected-tests-chips.component.scss',
})
export class SelectedTestsChipsComponent {
  items = input<CatalogItemModel[]>([]);

  tests = computed(() => this.items().filter((i) => i.kind === 'TEST'));
  packages = computed(() => this.items().filter((i) => i.kind === 'PACKAGE'));
}
