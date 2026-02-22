/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        cyan: {
          400: '#00f0ff', // VitalPath AI Cyan
          950: '#083344',
        },
        /* Design tokens — reference CSS variables from src/styles/theme.ts + index.css :root */
        'primary-red': 'var(--primary-red)',
        'primary-red-glow': 'var(--primary-red-glow)',
        'alert-amber': 'var(--alert-amber)',
        'background-dark': 'var(--background-dark)',
        'text-primary': 'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'success-green': 'var(--success-green)',
        'info-blue': 'var(--info-blue)',
      },
      borderRadius: {
        'standard': 'var(--radius-standard)',
        'large': 'var(--radius-large)',
      },
      boxShadow: {
        'glow-soft': 'var(--glow-soft)',
        'glow-strong': 'var(--glow-strong)',
      },
      backdropBlur: {
        'panel': 'var(--panel-blur)',
      },
    },
  },
  plugins: [],
}