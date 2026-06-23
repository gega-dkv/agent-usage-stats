import { NextResponse, type NextRequest } from 'next/server';

/**
 * CORS for local desktop/embedded clients.
 *
 * The dashboard server is normally consumed same-origin by its own pages. But
 * the Tauri desktop app renders a separate SPA (from a `tauri://` or
 * `localhost:1420` origin) that fetches these `/api/*` routes cross-origin.
 * Without CORS headers the browser/webview blocks every request, so the desktop
 * app's boot screen hangs on "compiling the dashboard".
 *
 * We allow any `http(s)://localhost:*` and `http(s)://127.0.0.1:*` origin plus
 * the Tauri webview schemes, and reflect the request's Origin so it's permissive
 * but still explicit (localhost-only — never a public origin).
 *
 * This is safe: all data is local, there's no auth, and the only consumers are
 * the dashboard itself and the embedded desktop shell.
 */
function isAllowedLocalOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (origin.startsWith('tauri://') || origin.startsWith('https://tauri.localhost')) return true;
  const url = (() => {
    try {
      return new URL(origin);
    } catch {
      return null;
    }
  })();
  if (!url) return false;
  const host = url.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return true;
  return false;
}

export function middleware(request: NextRequest) {
  const origin = request.headers.get('origin');

  // Handle preflight (OPTIONS) and actual requests uniformly.
  if (request.method === 'OPTIONS') {
    const res = new NextResponse(null, { status: 204 });
    if (isAllowedLocalOrigin(origin)) {
      res.headers.set('Access-Control-Allow-Origin', origin!);
      res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.headers.set(
        'Access-Control-Allow-Headers',
        'Content-Type, Accept, Authorization',
      );
      res.headers.set('Access-Control-Max-Age', '86400');
    }
    return res;
  }

  const res = NextResponse.next();
  if (isAllowedLocalOrigin(origin)) {
    res.headers.set('Access-Control-Allow-Origin', origin!);
    res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization');
    // Let the desktop app read any custom response headers if needed.
    res.headers.set('Access-Control-Expose-Headers', '*');
  }
  return res;
}

export const config = {
  // Apply only to API routes — pages don't need CORS.
  matcher: ['/api/:path*'],
};
