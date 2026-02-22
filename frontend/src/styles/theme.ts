/**
 * VitalPath AI design tokens.
 * Single source of truth for colors and effects. Keep in sync with :root in index.css.
 * Use these in TS/React; use var(--token-name) in CSS.
 */

export const theme = {
  colors: {
    /** Deep emergency red (primary brand) */
    primaryRed: '#B91C1C',
    /** Brighter red for glows and accents (matches current UI red) */
    primaryRedGlow: '#ef4444',
    /** Amber/yellow for alert mode */
    alertAmber: '#eab308',
    /** Darker red for critical cargo issues */
    dangerCrimson: '#7f1d1d',
    /** Near-black background */
    backgroundDark: '#050505',
    /** Dark translucent for glass panels */
    panelGlass: 'rgba(0, 0, 0, 0.4)',
    /** Low-opacity white/red border */
    borderSubtle: 'rgba(255, 255, 255, 0.1)',
    /** Primary text */
    textPrimary: '#ffffff',
    /** Muted secondary text */
    textSecondary: '#6b7280',
    /** Muted medical green */
    successGreen: '#34d399',
    /** Subtle cool blue */
    infoBlue: '#64748b',
    /** Roadblock / closure circle (bright red) */
    roadblockCircle: '#ff4444',
    /** Red-400 equivalent for text (current UI) */
    primaryRedLight: '#f87171',
    /** Grid / subtle pattern (current UI) */
    gridLine: '#333333',
    /** Scrollbar track */
    scrollbarTrack: '#000000',
    /** Scrollbar thumb */
    scrollbarThumb: '#333333',
    /** Alert amber rgba for overlays */
    alertAmberRgba: 'rgba(234, 179, 8, 0.5)',
    /** Primary red rgba for glows (0.2) */
    primaryRedGlowRgba20: 'rgba(239, 68, 68, 0.2)',
    /** Primary red rgba (0.35) */
    primaryRedGlowRgba35: 'rgba(239, 68, 68, 0.35)',
    /** Primary red rgba (0.5) */
    primaryRedGlowRgba50: 'rgba(239, 68, 68, 0.5)',
    /** Primary red rgba (0.08) */
    primaryRedGlowRgba08: 'rgba(239, 68, 68, 0.08)',
    /** Primary red rgba (0.15) */
    primaryRedGlowRgba15: 'rgba(239, 68, 68, 0.15)',
    /** Primary red rgba (0.3) */
    primaryRedGlowRgba30: 'rgba(239, 68, 68, 0.3)',
    /** Primary red rgba (0.45) */
    primaryRedGlowRgba45: 'rgba(239, 68, 68, 0.45)',
    /** Primary red rgba (0.6) */
    primaryRedGlowRgba60: 'rgba(239, 68, 68, 0.6)',
    /** Primary red rgba (0.9) */
    primaryRedGlowRgba90: 'rgba(239, 68, 68, 0.9)',
    /** White 60% */
    textMuted60: 'rgba(255, 255, 255, 0.6)',
    /** Welcome gradient start */
    welcomeBgStart: '#1a0a0a',
    /** Welcome gradient mid */
    welcomeBgMid: '#0a0505',
    /** Welcome gradient end */
    welcomeBgEnd: '#000000',
  },
  effects: {
    /** Soft red glow (box-shadow) */
    glowSoft: '0 0 20px rgba(239, 68, 68, 0.2)',
    /** Strong red glow */
    glowStrong: '0 0 40px rgba(239, 68, 68, 0.35)',
    /** Panel backdrop blur (Tailwind: backdrop-blur-md) */
    panelBlur: '12px',
    /** Standard border radius (Tailwind: rounded-lg) */
    borderRadiusStandard: '0.5rem',
    /** Large border radius (Tailwind: rounded-xl) */
    borderRadiusLarge: '0.75rem',
    /** Alert amber glow */
    glowAlertAmber: '0 0 15px rgba(234, 179, 8, 0.5)',
    /** Alert amber glow strong */
    glowAlertAmberStrong: '0 0 60px rgba(234, 179, 8, 0.4)',
  },
} as const;

export type Theme = typeof theme;
