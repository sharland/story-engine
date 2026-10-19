// Pack themes. A pack may carry theme/theme.css, with the fonts and images it
// uses, to skin the web page. The engine never reads it; it only carries it.
// Assets are inlined into the CSS as data: URLs so that a theme travels inside
// a one-file bundle and works from disk with no server.

import type { Issue } from './types.ts';

/** File types a theme may use, by extension. */
export const THEME_TYPES: Record<string, string> = {
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

/** Files in theme/ that are fine to have but are not part of the page: licences, notes. */
export const THEME_NOTES = ['.txt', '.md'];

/** Above this size the page gets slow to load; the validator warns. */
export const THEME_MAX_BYTES = 1_000_000;

export function themeType(file: string): string | null {
  const dot = file.lastIndexOf('.');
  return dot < 0 ? null : THEME_TYPES[file.slice(dot).toLowerCase()] ?? null;
}

/**
 * Replace every url(...) in theme.css that names a file in theme/ with a
 * data: URL. `assets` maps paths relative to theme/ to base64 contents.
 */
export function inlineTheme(css: string, assets: Map<string, string>, issues: Issue[]): string {
  const where = 'theme/theme.css';
  if (/@import\b/i.test(css)) {
    issues.push({ level: 'error', code: 'theme-import', message: '@import is not followed in a theme; put all the CSS in theme.css', where });
  }
  const out = css.replace(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi, (whole, _q: string, ref: string) => {
    const target = ref.trim();
    if (target === '' || target.startsWith('data:') || target.startsWith('#')) return whole;
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) {
      issues.push({
        level: 'warning',
        code: 'theme-external',
        message: `${target} is fetched from the internet when the page loads, so the theme breaks offline; put the file in theme/`,
        where,
      });
      return whole;
    }
    const path = normalise(target);
    const type = path === null ? null : themeType(path);
    const data = path === null ? undefined : assets.get(path);
    if (path === null || data === undefined || type === null) {
      issues.push({
        level: 'error',
        code: 'theme-missing-asset',
        message: `${target} is not a ${Object.keys(THEME_TYPES).join(', ')} file in theme/`,
        where,
      });
      return whole;
    }
    return `url("data:${type};base64,${data}")`;
  });
  if (out.length > THEME_MAX_BYTES) {
    issues.push({
      level: 'warning',
      code: 'theme-size',
      message: `The theme is ${Math.round(out.length / 1000)} KB with its fonts and images; above ${THEME_MAX_BYTES / 1000} KB the page is slow to load`,
      where,
    });
  }
  return out;
}

/** "./fonts/a.woff2" -> "fonts/a.woff2"; null if it leaves theme/. */
function normalise(ref: string): string | null {
  const parts: string[] = [];
  for (const p of ref.split(/[?#]/)[0].split('/')) {
    if (p === '' || p === '.') continue;
    if (p === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(p);
  }
  return parts.join('/');
}
