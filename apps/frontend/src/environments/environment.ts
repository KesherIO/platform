// Development environment config — kesherio-dev Supabase project.
// The anon key is public (it ships to the browser); never put a service-role key here.
// These values are read at build time.
// For production, configure real values via environment variables or Angular
// file-replacement in project.json.
export const environment = {
  production: false,
  supabaseUrl: 'https://gfrtaiyqzmbqmlusrizf.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdmcnRhaXlxem1icW1sdXNyaXpmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEzNzg4NjMsImV4cCI6MjEwNjk1NDg2M30.DmWZncZy3lQYjV3UiFNAMvinbeqBztGlUpAO29NGqPo',
  sentryDsn: '',
  sentryRelease: '',
};