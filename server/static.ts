/**
 * Static file serving for the built PWA, porting the behaviour of
 * docker/nginx.conf + docker/security-headers.conf: SPA fallback, per-path
 * cache policy, security headers and gzip, without nginx.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, normalize, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), interest-cohort=()',
};

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
};

/** Content types worth gzipping; images and fonts are already compressed. */
const COMPRESSIBLE = new Set([
  'text/html; charset=utf-8',
  'application/javascript; charset=utf-8',
  'text/css; charset=utf-8',
  'application/json; charset=utf-8',
  'application/manifest+json',
  'image/svg+xml',
  'text/plain; charset=utf-8',
]);

const NO_CACHE_FILES = new Set(['index.html', 'sw.js', 'registerSW.js', 'manifest.webmanifest']);

interface CacheEntry {
  mtimeMs: number;
  raw: Buffer;
  gzip: Buffer | null;
  contentType: string;
}

function extensionOf(path: string): string {
  const dot = path.lastIndexOf('.');
  const slash = path.lastIndexOf('/');
  return dot > slash ? path.slice(dot) : '';
}

function contentTypeFor(path: string): string {
  return MIME_TYPES[extensionOf(path)] ?? 'application/octet-stream';
}

function cacheControlFor(relativePath: string): string {
  const fileName = relativePath.split('/').pop() ?? '';
  if (NO_CACHE_FILES.has(fileName)) return 'no-cache, must-revalidate';
  if (relativePath.startsWith('assets/')) return 'public, max-age=31536000, immutable';
  if (relativePath.startsWith('icons/')) return 'public, max-age=2592000';
  return 'public, max-age=3600';
}

/**
 * Resolves a request path is a plain file the app shipped (has a file
 * extension, e.g. /assets/x.js, /manifest.webmanifest, /favicon.svg) versus
 * an app route that must fall back to index.html when nothing matches
 * (e.g. /t/<id>). This mirrors nginx: locations with an explicit prefix
 * (/assets/, /icons/) 404 on a miss, everything else rewrites to the shell.
 */
function looksLikeStaticAsset(pathname: string): boolean {
  const lastSegment = pathname.split('/').pop() ?? '';
  return lastSegment.includes('.');
}

export class StaticServer {
  private readonly root: string | null;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(root: string | null) {
    this.root = root && existsSync(root) ? root : null;
  }

  get available(): boolean {
    return this.root !== null;
  }

  /** Returns true if it handled the request (wrote a response), false if the caller should try something else. */
  handle(req: IncomingMessage, res: ServerResponse, pathname: string): boolean {
    if (!this.root) return false;
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;

    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const resolved = this.resolveWithinRoot(relative);

    if (resolved && existsSync(resolved) && statSync(resolved).isFile()) {
      this.serveFile(req, res, resolved, relative);
      return true;
    }

    if (looksLikeStaticAsset(pathname)) return false; // real 404, handled by the caller

    // SPA fallback: any other GET/HEAD is an app route.
    const shell = this.resolveWithinRoot('index.html');
    if (shell && existsSync(shell)) {
      this.serveFile(req, res, shell, 'index.html');
      return true;
    }
    return false;
  }

  /** Rejects any path that would escape the static root, e.g. via `..` segments. */
  private resolveWithinRoot(relative: string): string | null {
    if (!this.root) return null;
    const normalized = normalize(join(this.root, relative));
    if (normalized !== this.root && !normalized.startsWith(this.root + sep)) return null;
    return normalized;
  }

  private serveFile(req: IncomingMessage, res: ServerResponse, absolutePath: string, relativePath: string): void {
    const entry = this.loadCached(absolutePath, relativePath);
    const acceptsGzip = (req.headers['accept-encoding'] ?? '').toString().includes('gzip');
    const useGzip = acceptsGzip && entry.gzip !== null;
    const body = useGzip ? entry.gzip! : entry.raw;

    res.statusCode = 200;
    res.setHeader('Content-Type', entry.contentType);
    res.setHeader('Content-Length', body.length);
    res.setHeader('Cache-Control', cacheControlFor(relativePath));
    if (useGzip) res.setHeader('Content-Encoding', 'gzip');
    if (relativePath === 'sw.js') res.setHeader('Service-Worker-Allowed', '/');
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);

    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    res.end(body);
  }

  private loadCached(absolutePath: string, relativePath: string): CacheEntry {
    const stat = statSync(absolutePath);
    const cached = this.cache.get(absolutePath);
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached;

    const raw = readFileSync(absolutePath);
    const contentType = contentTypeFor(relativePath);
    const gzip = COMPRESSIBLE.has(contentType) && raw.length >= 1024 ? gzipSync(raw, { level: 6 }) : null;
    const entry: CacheEntry = { mtimeMs: stat.mtimeMs, raw, gzip, contentType };
    this.cache.set(absolutePath, entry);
    return entry;
  }
}
