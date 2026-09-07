import * as Sentry from '@sentry/react';

const dsn = import.meta.env.VITE_SENTRY_DSN || '';

if (dsn) {
  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || 'production',
    release: import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA || undefined,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    beforeSend(event) {
      if (event.request) {
        event.request.query_string = undefined;
        event.request.cookies = undefined;
        if (event.request.headers) {
          const headers = event.request.headers as Record<string, string>;
          delete headers['authorization'];
          delete headers['cookie'];
          delete headers['set-cookie'];
        }
      }
      if (event.request?.url) {
        try {
          const url = new URL(event.request.url);
          url.search = '';
          event.request.url = url.toString();
        } catch {
          // leave URL as-is if unparseable
        }
      }
      return event;
    },
  });

  // Temporary test mechanism — call window.__SENTRY_TEST__() from the browser
  // console to verify Sentry captures a controlled error. Remove before final handoff.
  (window as unknown as Record<string, unknown>)['__SENTRY_TEST__'] = () => {
    Sentry.captureException(new Error('Sentry test error — lab'));
    console.log('[Sentry] Test error captured. Check the kesherio-lab Sentry project.');
  };
}
