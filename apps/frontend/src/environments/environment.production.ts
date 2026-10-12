// Production environment config.
// These values are replaced at build time via project.json fileReplacements.
import { sentryConfig } from './environment.sentry';

export const environment = {
  production: true,
  supabaseUrl: 'https://vkraygviitfzgmrhbexd.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZrcmF5Z3ZpaXRmemdtcmhiZXhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE3OTU3OTEsImV4cCI6MjEwNzM3MTc5MX0.5KqWIDtPDQydWYkiF3AuiBTGY9qMqlDfHNl_wbmvWlY',
  sentryDsn: sentryConfig.dsn,
  sentryRelease: sentryConfig.release,
};