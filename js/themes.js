// Color themes (like Monkeytype): each theme is a few colors; the rest
// (button text, hover shades, success/warning boxes) is worked out from them.
// Themes only change the app; exported notebook images stay white.
//
// A theme sets CSS variables on <html>. The chosen colors are also kept in
// localStorage, so index.html can apply them before the page draws (no flash).

export const THEMES = [
  // id, name, dark?, colors: background, cards, text, muted text, borders, accent (buttons, links), strong (selected chips, headings)
  { id: 'classic', name: 'Classic', dark: false, c: ['#F4F5F7', '#FFFFFF', '#111827', '#4B5563', '#C9CED6', '#1E40AF', '#14213D'] },
  { id: 'paper', name: 'Paper', dark: false, c: ['#F5F0E6', '#FFFDF8', '#2B2621', '#625849', '#D8CFC0', '#9A3412', '#3D342B'] },
  { id: 'mint', name: 'Mint', dark: false, c: ['#E9F5EF', '#FFFFFF', '#10302A', '#45655C', '#BFDCCF', '#0F766E', '#134E4A'] },
  { id: 'lavender', name: 'Lavender', dark: false, c: ['#F3F0FA', '#FFFFFF', '#241B3A', '#5A5175', '#D5CDEA', '#6D28D9', '#3B2A6B'] },
  { id: 'peach', name: 'Peach', dark: false, c: ['#FFF1EA', '#FFFFFF', '#3A1F17', '#734F42', '#F0CDBE', '#C2410C', '#7C2D12'] },
  { id: 'candy', name: 'Candy', dark: false, c: ['#FFF0F6', '#FFFFFF', '#3A1029', '#78455F', '#F5C6DC', '#BE185D', '#831843'] },
  { id: 'red', name: 'Red Alliance', dark: false, c: ['#FFF5F5', '#FFFFFF', '#2A0E0E', '#744646', '#F1CACA', '#B91C1C', '#7F1D1D'] },
  { id: 'blue', name: 'Blue Alliance', dark: false, c: ['#F2F6FF', '#FFFFFF', '#0D1B3A', '#475779', '#C9D6F2', '#1D4ED8', '#1E3A8A'] },
  { id: 'mono', name: 'Mono', dark: false, c: ['#F4F4F4', '#FFFFFF', '#111111', '#525252', '#D4D4D4', '#111111', '#111111'] },
  { id: 'dark', name: 'Dark', dark: true, c: ['#111318', '#1C1F26', '#E8EAED', '#A3A9B5', '#363B48', '#7AB4FF', '#B9D7FF'] },
  { id: 'midnight', name: 'Midnight', dark: true, c: ['#0B1020', '#151C30', '#E6EAF5', '#9BA5C0', '#2C3553', '#8EA8FF', '#C7D2FE'] },
  { id: 'pit', name: 'Pit Lane', dark: true, c: ['#2C2E31', '#35373B', '#D9D8CE', '#A6A8A8', '#4D5054', '#E2B714', '#E2B714'] },
  { id: 'forest', name: 'Forest', dark: true, c: ['#0F1A14', '#18271F', '#DCEFE3', '#94B6A2', '#2E4638', '#4ADE80', '#A7F3C1'] },
  { id: 'vampire', name: 'Vampire', dark: true, c: ['#1E1F29', '#282A36', '#F8F8F2', '#A9ACC0', '#44475A', '#C6A2FF', '#FF92D0'] },
  { id: 'frost', name: 'Frost', dark: true, c: ['#2E3440', '#3B4252', '#ECEFF4', '#B8C0CE', '#55607A', '#88C0D0', '#8FBCBB'] },
  { id: 'contrast', name: 'High contrast', dark: true, c: ['#000000', '#000000', '#FFFFFF', '#E6E6E6', '#FFFFFF', '#FFE600', '#FFE600'] },
];

export const DEFAULT_THEME = 'classic';
const STORE_KEY = 'pitside-theme';

// ---- Color math (to pick readable text and soft shades) ----

function rgb(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}
const toHex = (c) => `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
// Mix two colors: amount 0 = a, 1 = b.
export const mix = (a, b, amount) => toHex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * amount));

// Relative luminance and contrast ratio (WCAG).
function luminance(hex) {
  const [r, g, b] = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
// Black or white, whichever is easier to read on this color.
const textOn = (hex) => (contrast(hex, '#000000') >= contrast(hex, '#FFFFFF') ? '#000000' : '#FFFFFF');

// ---- Theme -> CSS variables ----

export function themeVars(theme) {
  const [bg, surface, text, muted, border, primary, strong] = theme.c;
  const dark = theme.dark;
  const green = dark ? '#4ADE80' : '#15803D';
  const amber = dark ? '#FBBF24' : '#B45309';
  const red = dark ? '#F87171' : '#B91C1C';
  return {
    '--bg': bg,
    '--surface': surface,
    '--text': text,
    '--muted': muted,
    '--border': border,
    '--primary': primary,
    '--on-primary': textOn(primary),
    '--primary-dark': mix(primary, dark ? '#FFFFFF' : '#000000', 0.15),
    '--navy': strong,
    '--on-strong': textOn(strong),
    '--soft': mix(surface, text, dark ? 0.14 : 0.09),          // neutral fill (tags, thumbnails)
    '--hover': mix(surface, primary, dark ? 0.18 : 0.08),      // pressed list rows
    '--danger': red,
    '--on-danger': textOn(red),
    '--ok-bg': mix(surface, green, dark ? 0.18 : 0.14),
    '--ok-text': mix(green, text, dark ? 0.4 : 0.45),
    '--ok-border': mix(surface, green, 0.45),
    '--ok-strong': dark ? '#22C55E' : '#15803D',
    '--warn-bg': mix(surface, amber, dark ? 0.18 : 0.16),
    '--warn-text': mix(amber, text, dark ? 0.35 : 0.55),
    '--warn-border': mix(surface, amber, 0.5),
    '--switch-off': mix(surface, text, 0.4),
    'color-scheme': dark ? 'dark' : 'light',
  };
}

// A custom theme from 4 picked colors: background, cards, text, accent.
export function customTheme({ bg, surface, text, accent }) {
  const dark = luminance(bg) < 0.2;
  return {
    id: 'custom', name: 'Custom', dark,
    c: [bg, surface, text, mix(text, surface, 0.38), mix(surface, text, 0.25), accent, accent],
  };
}

// Which theme a setting means: 'auto' follows the phone's light/dark mode.
export function resolveTheme(themeId, custom) {
  if (themeId === 'custom' && custom) return customTheme(custom);
  if (themeId === 'auto') {
    const darkPhone = window.matchMedia('(prefers-color-scheme: dark)').matches;
    return THEMES.find((t) => t.id === (darkPhone ? 'dark' : 'classic'));
  }
  return THEMES.find((t) => t.id === themeId) || THEMES.find((t) => t.id === DEFAULT_THEME);
}

// Paint the app with a theme now, and remember it for the next start.
export function applyTheme(themeId, custom) {
  const theme = resolveTheme(themeId, custom);
  const vars = themeVars(theme);
  const root = document.documentElement;
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', vars['--surface']);
  try { localStorage.setItem(STORE_KEY, JSON.stringify(vars)); } catch { /* fine: just a flash next start */ }
  return theme;
}

// Re-apply "auto" when the phone switches between light and dark.
let autoListener = null;
export function watchAutoTheme(getSetting) {
  if (autoListener) return;
  autoListener = () => {
    const { theme, customTheme: custom } = getSetting();
    if (theme === 'auto') applyTheme('auto', custom);
  };
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', autoListener);
}
