import { Component, inject } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { TranslatePipe } from '@ngx-translate/core';

// TODO: When the lab interface is built, all of this data must come from the server.
//       The API should expose a GET /api/lab endpoint (or equivalent) returning a lab profile with:
//         - name: string
//         - email: string
//         - phone: string            (display-formatted, e.g. "+57 317 436 1989")
//         - whatsappNumber: string   (digits only, no +/spaces, e.g. "573174361989")
//         - address: string
//         - mapLat: number           (GPS latitude — verify exact coords when address is confirmed)
//         - mapLng: number           (GPS longitude)
//       Until then, these are hardcoded mock values for demo purposes.
export const LAB_CONTACT = {
  name: 'Biomet Lab',
  email: 'info@biometlab.com',
  phone: '+57 317 436 1989',
  address: 'Carrera 56 No. 7-54, Cali, Colombia',
  whatsappNumber: '573174361989',
  mapLat: 3.4516, // TODO: verify exact coords once address is confirmed
  mapLng: -76.532, // TODO: verify exact coords once address is confirmed
} as const;

@Component({
  selector: 'app-contact-lab-settings',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './contact-lab-settings.component.html',
  styleUrl: './contact-lab-settings.component.scss',
})
export class ContactLabSettingsComponent {
  private readonly sanitizer = inject(DomSanitizer);

  readonly lab = LAB_CONTACT;

  readonly labWhatsAppUrl = `https://wa.me/${LAB_CONTACT.whatsappNumber}`;

  readonly mapEmbedUrl: SafeResourceUrl =
    this.sanitizer.bypassSecurityTrustResourceUrl(
      `https://www.openstreetmap.org/export/embed.html` +
        `?bbox=${LAB_CONTACT.mapLng - 0.02}%2C${LAB_CONTACT.mapLat - 0.015}` +
        `%2C${LAB_CONTACT.mapLng + 0.02}%2C${LAB_CONTACT.mapLat + 0.015}` +
        `&layer=mapnik&marker=${LAB_CONTACT.mapLat}%2C${LAB_CONTACT.mapLng}`
    );
}
