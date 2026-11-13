import { type NextRequest, NextResponse } from "next/server";
import { contentSecurityPolicy } from "./server/http/security-headers";

/**
 * Per-request CSP nonce for pages (Next applies it to its own scripts; the layout passes it to the theme boot
 * script). Nonces require dynamic rendering, which is why cacheComponents/PPR are off (docs/v2/07).
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = contentSecurityPolicy(nonce, process.env.NODE_ENV === "development");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      // pages only: not the API, static assets, the service worker or the manifest
      source: "/((?!api|_next/static|_next/image|icons|favicon.ico|icons.svg|sw.js|manifest.webmanifest).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
