/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./apps/frontend/src/**/*.{html,ts}'],
  theme: {
    extend: {
      colors: {
        // ── Design system tokens ──────────────────────────────────
        accent: '#66E0E5', // primary-accent: text on black buttons / AI / turquoise
        secondary: '#A65AF4', // secondary: create / new / important actions

        // ── Legacy palette (kept for backward compatibility) ──────
        primary: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
          800: '#075985',
          900: '#0c4a6e',
        },
        cyan: {
          DEFAULT: '#66E0E5',
          light: '#99ECEF',
          dark: '#29B8BE',
        },
        purple: {
          DEFAULT: '#A65AF4', // updated to new secondary color
          light: '#C77DFF',
          dark: '#7209B7',
        },
        black: '#000000',
        gray: {
          50: '#F9FAFB',
          100: '#F3F4F6',
          200: '#E5E7EB',
          300: '#D1D5DB',
          400: '#9CA3AF',
          500: '#6B7280',
          600: '#4B5563',
          700: '#374151',
          800: '#1F2937',
          900: '#111827',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
