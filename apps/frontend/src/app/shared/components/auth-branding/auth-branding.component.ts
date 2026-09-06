import { Component } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'app-auth-branding',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './auth-branding.component.html',
})
export class AuthBrandingComponent {}
