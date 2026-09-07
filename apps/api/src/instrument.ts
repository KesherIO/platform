import * as Sentry from '@sentry/nestjs';

const SENSITIVE_HEADER_KEYS = [
  'authorization',
  'cookie',
  'x-internal-api-key',
  'x-tenant-id',
  'set-cookie',
];

const SENSITIVE_PATTERNS = /email|phone|address|token|password|secret|key|credential|ssn|license/i;

function sanitizeHeaders(
  headers?: Record<string, string>,
): Record<string, string> | undefined {
  if (!headers) return undefined;
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (SENSITIVE_HEADER_KEYS.includes(key.toLowerCase())) {
      sanitized[key] = '[Filtered]';
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function sanitizeObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_PATTERNS.test(key)) {
      result[key] = '[Filtered]';
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result[key] = sanitizeObject(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

const dsn = process.env['SENTRY_DSN'] || '';

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env['SENTRY_ENVIRONMENT'] || 'production',
    release: process.env['RAILWAY_GIT_COMMIT_SHA'] || undefined,
    tracesSampleRate: parseFloat(
      process.env['SENTRY_TRACES_SAMPLE_RATE'] || '0.1',
    ),
    ignoreTransactions: [
      'GET /api/health/live',
      'GET /api/health/ready',
    ],
    beforeSend(event) {
      const statusCode =
        (event.contexts?.response as Record<string, unknown>)?.['status_code'] ??
        (event.extra?.['statusCode'] as number | undefined);

      if (statusCode === 401 || statusCode === 403 || statusCode === 404) {
        return null;
      }

      if (event.request) {
        event.request.data = undefined;
        event.request.cookies = undefined;
        event.request.query_string = undefined;
        event.request.headers = sanitizeHeaders(
          event.request.headers as Record<string, string> | undefined,
        );
      }

      if (event.extra) {
        event.extra = sanitizeObject(event.extra as Record<string, unknown>);
      }

      if (event.tags) {
        event.tags = sanitizeObject(event.tags as Record<string, unknown>) as Record<string, string>;
      }

      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map((bc) => {
          if (bc.data) {
            bc.data = sanitizeObject(bc.data as Record<string, unknown>);
          }
          return bc;
        });
      }

      return event;
    },
    beforeSendTransaction(event) {
      if (event.request) {
        event.request.data = undefined;
        event.request.cookies = undefined;
        event.request.query_string = undefined;
        event.request.headers = sanitizeHeaders(
          event.request.headers as Record<string, string> | undefined,
        );
      }
      return event;
    },
  });
}
