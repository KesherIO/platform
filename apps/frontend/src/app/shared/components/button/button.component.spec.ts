import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ButtonComponent } from './button.component';

describe('ButtonComponent', () => {
  let component: ButtonComponent;
  let fixture: ComponentFixture<ButtonComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ButtonComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ButtonComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('default inputs', () => {
    it('should default to button type', () => {
      expect(component.type).toBe('button');
    });

    it('should default to primary variant', () => {
      expect(component.variant).toBe('primary');
    });

    it('should default to fullWidth true', () => {
      expect(component.fullWidth).toBe(true);
    });

    it('should default to not disabled', () => {
      expect(component.disabled).toBe(false);
    });
  });

  describe('getButtonClass()', () => {
    it('should include w-full when fullWidth is true', () => {
      component.fullWidth = true;
      expect(component.getButtonClass()).toContain('w-full');
    });

    it('should not include w-full when fullWidth is false', () => {
      component.fullWidth = false;
      expect(component.getButtonClass()).not.toContain('w-full');
    });

    it('should include primary classes for primary variant', () => {
      component.variant = 'primary';
      const cls = component.getButtonClass();
      expect(cls).toContain('bg-black');
      expect(cls).toContain('text-cyan');
    });

    it('should include gradient classes for gradient variant', () => {
      component.variant = 'gradient';
      const cls = component.getButtonClass();
      expect(cls).toContain('from-purple-dark');
      expect(cls).toContain('text-white');
    });

    it('should include base classes regardless of variant', () => {
      const cls = component.getButtonClass();
      expect(cls).toContain('rounded-full');
      expect(cls).toContain('font-medium');
      expect(cls).toContain('transition-all');
    });
  });
});