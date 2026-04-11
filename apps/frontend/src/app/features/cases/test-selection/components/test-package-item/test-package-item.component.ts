import { Component, input, output, signal, computed } from '@angular/core';
import { CatalogItemModel } from '@vet-ai/shared-types';

@Component({
  selector: 'app-test-package-item',
  standalone: true,
  imports: [],
  templateUrl: './test-package-item.component.html',
  styleUrl: './test-package-item.component.scss',
})
export class TestPackageItemComponent {
  item = input.required<CatalogItemModel>();
  selected = input.required<boolean>();

  toggled = output<void>();

  expanded = signal(false);
  hasComponents = computed(() => (this.item().components?.length ?? 0) > 0);

  toggleExpand(event: Event): void {
    event.stopPropagation();
    this.expanded.update((v) => !v);
  }
}
