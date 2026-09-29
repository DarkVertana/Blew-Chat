import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/constants";

const PUBLIC_PATHS = new Set(["/login", "/register"]);
const isDev = process.env.NODE_ENV !== "production";

// Cheap cookie-presence gate so visitors without a session never render a
// protected page (pages still validate the session against the API through
// requireUser()), plus a per-request nonce for the Content Security Policy.
// Next.js reads the nonce from the CSP request header and applies it to the
// scripts it emits, so inline scripts without it are blocked.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!PUBLIC_PATHS.has(pathname) && !request.cookies.has(SESSION_COOKIE)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  const nonce = btoa(crypto.randomUUID());
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src 'self' ${request.nextUrl.protocol === "https:" ? "wss:" : "ws:"}//${request.nextUrl.host}${isDev ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "worker-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = {
  // Profile route handlers authenticate and check CSRF themselves. Skipping
  // proxy body cloning keeps long About saves free of its buffering limit.
  matcher: ["/((?!_next/|api/(?:profile|notifications|bots|companion|speech|live)(?:/|$)|.*\\..*).*)"],
};
