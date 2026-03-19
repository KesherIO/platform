import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BrandingFooterComponent } from './branding-footer.component';
import { provideTranslateService } from '@ngx-translate/core';

describe('BrandingFooterComponent', () => {
  let component: BrandingFooterComponent;
  let fixture: ComponentFixture<BrandingFooterComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BrandingFooterComponent],
      providers: [provideTranslateService({ defaultLanguage: 'en' })],
    }).compileComponents();

    fixture = TestBed.createComponent(BrandingFooterComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should default logoUrl to the icon-128x128 asset', () => {
    expect(component.logoUrl).toBe('/assets/icons/icon-128x128.png');
  });

  it('should accept a custom logoUrl input', () => {
    component.logoUrl = '/assets/custom-logo.png';
    fixture.detectChanges();
    expect(component.logoUrl).toBe('/assets/custom-logo.png');
  });

  it('should render an img element with the logoUrl', () => {
    const img = fixture.nativeElement.querySelector('img') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.src).toContain('icon-128x128.png');
  });
});