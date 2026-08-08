import { useEffect } from 'react';
import { labApi } from '../../shared/api/labApi';

// Converts the VAPID public key (URL-safe base64) into the Uint8Array shape
// the Push API expects for `applicationServerKey`.
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64Safe);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/**
 * Registers the service worker and subscribes this browser to Web Push, once,
 * for the current MESSENGER user. No-ops silently if the browser doesn't
 * support push, permission is denied, or no VAPID key is configured — the
 * messenger still sees their pickups next time they open the app either way.
 */
export function usePushSubscription(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const publicKey = import.meta.env['VITE_VAPID_PUBLIC_KEY'] as
      | string
      | undefined;
    if (
      !publicKey ||
      !('serviceWorker' in navigator) ||
      !('PushManager' in window)
    ) {
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js');
        const permission = await Notification.requestPermission();
        if (cancelled || permission !== 'granted') return;

        const existing = await registration.pushManager.getSubscription();
        const subscription =
          existing ??
          (await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(
              publicKey
            ) as BufferSource,
          }));

        const json = subscription.toJSON();
        if (!json.endpoint || !json.keys?.['p256dh'] || !json.keys?.['auth']) {
          return;
        }

        await labApi.messengers.savePushSubscription({
          endpoint: json.endpoint,
          keys: { p256dh: json.keys['p256dh'], auth: json.keys['auth'] },
        });
      } catch {
        // Soft-fail — push is a nice-to-have, not a requirement.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled]);
}
