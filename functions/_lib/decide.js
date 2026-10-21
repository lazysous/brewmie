// Pure routing decision for the Pages Function in ../[[path]].js (brewmie-78).
// Input: a URL pathname. Output: { kind: 'landing' | 'notfound' | 'passthrough' }.
//
// The function is only invoked for paths that public/_routes.json does NOT exclude, so a request that reaches
// it is normally '/' or a path with no file. This list repeats the static paths on purpose (defence in depth:
// if _routes.json is ever ignored, the shell and the assets still pass straight through). tests/pages-function.test.ts
// fails when public/ gains a file or folder that is in neither list, so the two cannot drift silently.

// Folders served as files. A request for the folder itself or anything under it passes through.
export const STATIC_PREFIXES = ['/app', '/assets', '/fonts', '/translations', '/ota']

// Exact files, plus the clean URLs Pages gives the .html files.
export const STATIC_EXACT = [
  '/index.html',
  '/landing', '/landing.html',
  '/privacy', '/privacy.html',
  '/support', '/support.html',
  '/delete-account', '/delete-account.html',
  '/manifest.json', '/llms.txt', '/robots.txt', '/sitemap.xml',
]

// Real files under /.well-known/ (none today). Everything else there is a 404. Add the path here AND to _routes.json.
export const WELL_KNOWN_FILES = []

function underPrefix(pathname, prefix) {
  return pathname === prefix || pathname.startsWith(prefix + '/')
}

export function decide(pathname) {
  const p = typeof pathname === 'string' && pathname.startsWith('/') ? pathname : '/' + String(pathname || '')
  if (p === '/') return { kind: 'landing' }
  if (WELL_KNOWN_FILES.includes(p)) return { kind: 'passthrough' }
  if (underPrefix(p, '/.well-known')) return { kind: 'notfound' }
  if (STATIC_EXACT.includes(p)) return { kind: 'passthrough' }
  if (STATIC_PREFIXES.some((prefix) => underPrefix(p, prefix))) return { kind: 'passthrough' }
  return { kind: 'notfound' }
}
