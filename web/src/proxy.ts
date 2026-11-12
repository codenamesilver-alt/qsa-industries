import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// In-memory rate limiter (per IP). Resets on server restart; sufficient for local/demo.
const buckets = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = 500; // per minute per IP

function rateLimit(ip: string): boolean {
  const now = Date.now();
  const rec = buckets.get(ip);
  if (!rec || now > rec.resetAt) {
    buckets.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (rec.count >= MAX_REQUESTS) return false;
  rec.count += 1;
  return true;
}

export function proxy(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

  // CSRF mitigation for state-changing requests
  if (request.method !== "GET" && request.method !== "HEAD" && request.method !== "OPTIONS") {
    const origin = request.headers.get("origin");
    const host = request.headers.get("host");
    if (origin) {
      try {
        const originHost = new URL(origin).host;
        if (host && originHost !== host) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
      } catch {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
  }

  // Global rate limit
  if (!rateLimit(ip)) {
    return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
