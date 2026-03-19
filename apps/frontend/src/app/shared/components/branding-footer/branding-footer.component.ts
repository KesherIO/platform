import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'app-branding-footer',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  templateUrl: './branding-footer.component.html',
})
export class BrandingFooterComponent {
  @Input() logoUrl = '/assets/icons/icon-128x128.png';
}
