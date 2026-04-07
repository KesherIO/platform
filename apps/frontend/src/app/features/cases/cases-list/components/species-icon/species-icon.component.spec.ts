import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SpeciesIconComponent } from './species-icon.component';
import { PatientSpecies } from '@vet-ai/shared-types';

describe('SpeciesIconComponent', () => {
  let fixture: ComponentFixture<SpeciesIconComponent>;
  let component: SpeciesIconComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SpeciesIconComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(SpeciesIconComponent);
    component = fixture.componentInstance;
  });

  const setup = (species: PatientSpecies) => {
    fixture.componentRef.setInput('species', species);
    fixture.detectChanges();
  };

  // ── Creation ──────────────────────────────────────────────────────────────

  it('should create', () => {
    setup(PatientSpecies.DOG);
    expect(component).toBeTruthy();
  });

  // ── iconSrc getter ────────────────────────────────────────────────────────

  it.each([
    [PatientSpecies.DOG, 'assets/icons/dog.png'],
    [PatientSpecies.CAT, 'assets/icons/cat.png'],
    [PatientSpecies.EQUINE, 'assets/icons/equine.png'],
    [PatientSpecies.BOVINE, 'assets/icons/bovine.png'],
    [PatientSpecies.BIRD, 'assets/icons/bird.png'],
    [PatientSpecies.REPTILE, 'assets/icons/reptile.png'],
    [PatientSpecies.RABBIT, 'assets/icons/rabbit.png'],
    [PatientSpecies.OTHER, 'assets/icons/other.png'],
  ])('iconSrc returns correct path for %s', (species, expectedPath) => {
    setup(species);
    expect(component.iconSrc).toBe(expectedPath);
  });

  // ── img element ───────────────────────────────────────────────────────────

  it('renders an img element', () => {
    setup(PatientSpecies.DOG);
    expect(fixture.nativeElement.querySelector('img')).toBeTruthy();
  });

  it('img src matches iconSrc', () => {
    setup(PatientSpecies.CAT);
    const img: HTMLImageElement = fixture.nativeElement.querySelector('img');
    expect(img.src).toContain('assets/icons/cat.png');
  });

  it('img alt matches species value', () => {
    setup(PatientSpecies.DOG);
    const img: HTMLImageElement = fixture.nativeElement.querySelector('img');
    expect(img.alt).toBe(PatientSpecies.DOG);
  });

  it('updates img src when species input changes', () => {
    setup(PatientSpecies.DOG);
    fixture.componentRef.setInput('species', PatientSpecies.BIRD);
    fixture.detectChanges();
    const img: HTMLImageElement = fixture.nativeElement.querySelector('img');
    expect(img.src).toContain('assets/icons/bird.png');
  });
});
