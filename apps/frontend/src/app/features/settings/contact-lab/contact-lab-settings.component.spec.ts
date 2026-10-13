import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ContactLabSettingsComponent } from './contact-lab-settings.component';
import { provideTranslateService } from '@ngx-translate/core';
import { provideHttpClient } from '@angular/common/http';
import {
  SettingsService,
  LabContact,
} from '../../../core/services/settings.service';
import { of } from 'rxjs';

const MOCK_LAB: LabContact = {
  name: 'Test Lab',
  email: 'lab@test.com',
  phone: '+1 555 555',
  address: '123 Test St',
  logoUrl: null,
  phoneNumbers: [
    { label: 'whatsapp', number: '+573174361989' },
    { label: 'commercial', number: '+1 555 000' },
  ],
  mapLat: 3.45,
  mapLng: -76.53,
};

describe('ContactLabSettingsComponent', () => {
  let fixture: ComponentFixture<ContactLabSettingsComponent>;
  let component: ContactLabSettingsComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ContactLabSettingsComponent],
      providers: [
        provideTranslateService({ defaultLanguage: 'en' }),
        provideHttpClient(),
        {
          provide: SettingsService,
          useValue: { getLabContact: () => of(MOCK_LAB) },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ContactLabSettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('loads lab contact from service', () => {
    expect(component.lab()?.name).toBe('Test Lab');
    expect(component.loading()).toBe(false);
  });

  it('derives WhatsApp URL from whatsapp-labeled phone', () => {
    expect(component.whatsAppUrl()).toBe('https://wa.me/573174361989');
  });

  it('computes phone list from phoneNumbers', () => {
    expect(component.phones().length).toBe(2);
  });

  it('derives WhatsApp URL from the WhatsApp checkbox', () => {
    component.lab.set({
      ...MOCK_LAB,
      phoneNumbers: [
        { label: 'Urgencias', number: '+57 601 555 0000' },
        { label: 'Recepción', number: '+57 300 111 2222', whatsapp: true },
      ],
    });
    expect(component.whatsAppUrl()).toBe('https://wa.me/573001112222');
  });

  it('has no WhatsApp URL when no number is marked', () => {
    component.lab.set({
      ...MOCK_LAB,
      phoneNumbers: [{ label: 'Urgencias', number: '+57 601 555 0000' }],
    });
    expect(component.whatsAppUrl()).toBeNull();
  });

  it('shows custom labels as typed and old codes through translation keys', () => {
    expect(component.customLabel({ label: ' Recepción ', number: '1' })).toBe(
      'Recepción'
    );
    expect(component.legacyLabelKey({ label: 'commercial', number: '1' })).toBe(
      'SETTINGS.CONTACT_LAB.PHONE_COMMERCIAL'
    );
    expect(component.customLabel({ label: 'commercial', number: '1' })).toBe(
      ''
    );
    expect(component.customLabel({ label: 'whatsapp', number: '1' })).toBe('');
    expect(component.isWhatsApp({ label: 'whatsapp', number: '1' })).toBe(true);
  });

  it('renders a custom label with the WhatsApp tag', () => {
    component.lab.set({
      ...MOCK_LAB,
      phoneNumbers: [
        { label: 'Recepción', number: '+57 300 111 2222', whatsapp: true },
      ],
    });
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Recepción');
    expect(text).toContain('SETTINGS.CONTACT_LAB.PHONE_WHATSAPP');
  });
});
