import { Component, OnInit, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

@Component({
  selector: 'app-pwa-install-banner',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './pwa-install-banner.component.html',
  styleUrl: './pwa-install-banner.component.scss',
})
export class PwaInstallBannerComponent implements OnInit {
  readonly visible = signal(false);

  // Holds the browser's deferred install prompt event.
  private deferredPrompt: BeforeInstallPromptEvent | null = null;

  ngOnInit(): void {
    // Only show if the user hasn't already dismissed or installed.
    if (localStorage.getItem('pwa_install_dismissed')) return;

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredPrompt = e as BeforeInstallPromptEvent;
      this.visible.set(true);
    });
  }

  install(): void {
    if (!this.deferredPrompt) return;
    this.deferredPrompt.prompt();
    this.deferredPrompt.userChoice.then(() => {
      this.deferredPrompt = null;
      this.visible.set(false);
    });
  }

  dismiss(): void {
    localStorage.setItem('pwa_install_dismissed', '1');
    this.visible.set(false);
  }
}

// Extend the Window event type for TypeScript.
interface BeforeInstallPromptEvent extends Event {
  prompt(): void;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}