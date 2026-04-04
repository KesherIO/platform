import { Component, inject, signal, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { AuthService } from '../../../core/services/auth.service';
import { PrimaryButtonComponent } from '../../../shared/components/primary-button/primary-button.component';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, PrimaryButtonComponent],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  readonly form = this.fb.group({
    email:    ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
  });

  readonly resetForm = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
  });

  readonly view = signal<'login' | 'reset'>('login');
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly resetSent = signal(false);

  showReset(): void {
    this.view.set('reset');
    this.error.set(null);
    this.resetSent.set(false);
  }

  showLogin(): void {
    this.view.set('login');
    this.error.set(null);
  }

  submit(): void {
    if (this.form.invalid) return;

    this.loading.set(true);
    this.error.set(null);

    const { email, password } = this.form.getRawValue();

    this.auth.signInWithPassword(email!, password!)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.loading.set(false),
        error: (err: { message?: string }) => {
          this.loading.set(false);
          this.error.set(err?.message ?? 'AUTH.ERROR_GENERIC');
        },
      });
  }

  submitReset(): void {
    if (this.resetForm.invalid) return;

    this.loading.set(true);
    this.error.set(null);

    const { email } = this.resetForm.getRawValue();

    this.auth.resetPassword(email!)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.loading.set(false);
          this.resetSent.set(true);
        },
        error: (err: { message?: string }) => {
          this.loading.set(false);
          this.error.set(err?.message ?? 'AUTH.ERROR_GENERIC');
        },
      });
  }
}