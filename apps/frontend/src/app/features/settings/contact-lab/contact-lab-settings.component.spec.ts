import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  ContactLabSettingsComponent,
  LAB_CONTACT,
} from './contact-lab-settings.component';
import { provideTranslateService } from '@ngx-translate/core';

describe('ContactLabSettingsComponent', () => {
  let fixture: ComponentFixture<ContactLabSettingsComponent>;
  let component: ContactLabSettingsComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ContactLabSettingsComponent],
      providers: [provideTranslateService({ defaultLanguage: 'en' })],
    }).compileComponents();

    fixture = TestBed.createComponent(ContactLabSettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('lab exposes mock contact info', () => {
    expect(component.lab.name).toBe('Biomet Lab');
    expect(component.lab.email).toBeTruthy();
    expect(component.lab.phone).toBeTruthy();
    expect(component.lab.address).toContain('Cali');
  });

  it('labWhatsAppUrl is a valid wa.me link with the correct number', () => {
    expect(component.labWhatsAppUrl).toBe(
      `https://wa.me/${LAB_CONTACT.whatsappNumber}`
    );
  });

  it('mapEmbedUrl is a trusted resource URL for OpenStreetMap', () => {
    // DomSanitizer wraps it; verify via the fixture's rendered iframe src attribute
    const iframe = fixture.nativeElement.querySelector(
      'iframe'
    ) as HTMLIFrameElement;
    expect(iframe).toBeTruthy();
    expect(iframe.src).toContain('openstreetmap.org');
  });
});
