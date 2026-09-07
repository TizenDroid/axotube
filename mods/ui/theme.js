import { configRead } from '../config.js';

const THEME_BLOCK_PREFIX = '/* ytaf-theme-start */';
const THEME_BLOCK_SUFFIX = '/* ytaf-theme-end */';
const style = document.createElement('style');
let css = '';

const TEXT_THEMES = {
  default: null,
  white: ['#ffffff', '#e0e0e0', '#c0c0c0'],
  gray: ['#d0d0d0', '#9a9a9a', '#7f7f7f'],
  red: ['#ff7a7a', '#e06a6a', '#c25b5b'],
  blue: ['#8ab4ff', '#6f96e8', '#5a79c9'],
  green: ['#81c995', '#68a87a', '#538c64'],
  purple: ['#d7aefb', '#b28fd8', '#8f70b5'],
  yellow: ['#fdd663', '#d9b34d', '#b5913c'],
};

function safeColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? value : '#0f0f0f';
}

function safeBackgroundUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return raw.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]/g, '');
  } catch (e) {
    return '';
  }
}

function luminance(color) {
  const m = /rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/.exec(color);
  if (!m) return null;
  const r = Number(m[1]);
  const g = Number(m[2]);
  const b = Number(m[3]);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function elementSelector(el) {
  const classes = String(el.className || '')
    .split(/\s+/)
    .filter((c) => c && /^[A-Za-z0-9_-]+$/.test(c));
  if (!classes.length || !el.tagName) return '';
  return el.tagName.toLowerCase() + classes.map((c) => '.' + c).join('');
}

function textThemeCss(theme) {
  const palette = TEXT_THEMES[theme];
  const container = document.getElementById('container');
  if (!palette || !container) return '';
  const groups = [[], [], []];
  const seen = {};
  const els = container.querySelectorAll('*');
  for (let i = 0; i < els.length; i++) {
    const lum = luminance(getComputedStyle(els[i]).color);
    if (lum === null || lum < 0.3) continue;
    const tier = lum > 0.8 ? 0 : lum > 0.55 ? 1 : 2;
    const sel = elementSelector(els[i]);
    if (!sel || seen[sel]) continue;
    seen[sel] = true;
    groups[tier].push(sel);
  }
  let textCss = '';
  for (let t = 0; t < 3; t++) {
    if (groups[t].length) textCss += groups[t].join(',\n') + ' {\n    color: ' + palette[t] + ' !important;\n  }\n';
  }
  return textCss;
}

function updateStyle() {
  const bgUrl = safeBackgroundUrl(configRead('routeBackgroundUrl'));
  const bg = bgUrl
    ? `\n        background-image: url("${bgUrl}") !important;\n        background-size: cover !important;\n        background-position: center !important;\n        background-repeat: no-repeat !important;`
    : `\n        background-color: ${safeColor(configRead('routeColor'))} !important;`;
  const navbar = bgUrl
    ? `\n      ytlr-guide-response {\n          background-image: none !important;\n          background-color: rgba(15, 15, 15, 0.35) !important;\n      }\n      ytlr-guide-response > div {\n          background-image: none !important;\n          background-color: transparent !important;\n      }\n      ytlr-guide-response .zylon-ve {\n          background-image: none !important;\n          background-color: transparent !important;\n      }`
    : '';
  const textTheme = textThemeCss(configRead('textTheme'));
  css = `\n    ${THEME_BLOCK_PREFIX}\n    #container {\n        ${bg}\n    }\n    ${navbar}\n    ${textTheme}\n    ${THEME_BLOCK_SUFFIX}\n`;

  const existingStyle = document.querySelector('style[nonce]');
  if (existingStyle) {
    let text = existingStyle.textContent || '';
    const startIdx = text.indexOf(THEME_BLOCK_PREFIX);
    const endIdx = text.indexOf(THEME_BLOCK_SUFFIX);
    if (startIdx !== -1 && endIdx !== -1) {
      text = text.slice(0, startIdx) + text.slice(endIdx + THEME_BLOCK_SUFFIX.length);
    }
    existingStyle.textContent = text + css;
  } else {
    style.textContent = css;
    if (!style.parentNode && document.head) document.head.appendChild(style);
  }
}

if (document.head) document.head.appendChild(style);
updateStyle();
setTimeout(updateStyle, 1500);

let reapplyTimer = null;
if (window.addEventListener) {
  window.addEventListener('hashchange', function () {
    if (reapplyTimer) clearTimeout(reapplyTimer);
    reapplyTimer = setTimeout(updateStyle, 150);
  });
}

export default updateStyle;
