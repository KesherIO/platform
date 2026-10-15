import {
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DomSanitizer } from '@angular/platform-browser';
import { TranslatePipe } from '@ngx-translate/core';
import { LabPhoneNumber } from '@vet-ai/shared-types';
import {
  SettingsService,
  LabContact,
} from '../../../core/services/settings.service';

@Component({
  selector: 'app-contact-lab-settings',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './contact-lab-settings.component.html',
  styleUrl: './contact-lab-settings.component.scss',
})
export class ContactLabSettingsComponent implements OnInit {
  private readonly sanitizer = inject(DomSanitizer);
  private readonly settings = inject(SettingsService);
  private readonly destroyRef = inject(DestroyRef);

  readonly lab = signal<LabContact | null>(null);
  readonly loading = signal(true);
  readonly error = signal(false);

  readonly labLogoSrc = computed(() => {
    const l = this.lab();
    return l?.logoUrl || 'assets/icons/default_logo.png';
  });

  readonly phones = computed(() => {
    const l = this.lab();
    return Array.isArray(l?.phoneNumbers) ? l!.phoneNumbers : [];
  });

  readonly whatsAppUrl = computed(() => {
    const wp = this.phones().find((p) => this.isWhatsApp(p));
    if (!wp) return null;
    const digits = wp.number.replace(/\D/g, '');
    return `https://wa.me/${digits}`;
  });

  readonly mapEmbedUrl = computed(() => {
    const l = this.lab();
    if (l?.mapLat == null || l?.mapLng == null) return null;
    return this.sanitizer.bypassSecurityTrustResourceUrl(
      `https://www.openstreetmap.org/export/embed.html` +
        `?bbox=${l.mapLng - 0.02}%2C${l.mapLat - 0.015}` +
        `%2C${l.mapLng + 0.02}%2C${l.mapLat + 0.015}` +
        `&layer=mapnik&marker=${l.mapLat}%2C${l.mapLng}`
    );
  });

  readonly googleMapsUrl = computed(() => {
    const l = this.lab();
    if (l?.mapLat == null || l?.mapLng == null) return null;
    return `https://www.google.com/maps/search/?api=1&query=${l.mapLat},${l.mapLng}`;
  });

  readonly wazeUrl = computed(() => {
    const l = this.lab();
    if (l?.mapLat == null || l?.mapLng == null) return null;
    return `https://www.waze.com/ul?ll=${l.mapLat},${l.mapLng}&navigate=yes`;
  });

  ngOnInit(): void {
    this.settings
      .getLabContact()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.lab.set(data);
          this.loading.set(false);
        },
        error: () => {
          this.error.set(true);
          this.loading.set(false);
        },
      });
  }

  /** The WhatsApp checkbox, or the old dropdown's "whatsapp" label. */
  isWhatsApp(phone: LabPhoneNumber): boolean {
    return phone.whatsapp === true || phone.label === 'whatsapp';
  }

  /** Translation key for a label saved by the old dropdown, else null. */
  legacyLabelKey(phone: LabPhoneNumber): string | null {
    const map: Record<string, string> = {
      commercial: 'SETTINGS.CONTACT_LAB.PHONE_COMMERCIAL',
      personal: 'SETTINGS.CONTACT_LAB.PHONE_PERSONAL',
      other: 'SETTINGS.CONTACT_LAB.PHONE_OTHER',
    };
    return map[phone.label] ?? null;
  }

  /** An old code or the lab's own text to show under the number. */
  hasLabel(phone: LabPhoneNumber): boolean {
    return !!this.legacyLabelKey(phone) || !!this.customLabel(phone);
  }

  /** "· WhatsApp" after the label — not when the label already says it. */
  showWhatsAppTag(phone: LabPhoneNumber): boolean {
    return (
      this.isWhatsApp(phone) &&
      !/\bwhats\s?app\b/i.test(this.customLabel(phone))
    );
  }

  /** The lab's own label text ("Recepción"); empty for old codes. */
  customLabel(phone: LabPhoneNumber): string {
    if (phone.label === 'whatsapp' || this.legacyLabelKey(phone)) return '';
    return phone.label.trim();
  }
}
