import { headers } from "next/headers";

// Server-side client for the Go API. Only import this from server components,
// route handlers, or server actions: API_URL and session tokens never reach
// the browser.
//
// In compose, API_URL=http://api:8080 (the service name on the compose network).
// Outside Docker it falls back to localhost.
const API_URL = process.env.API_URL ?? "http://localhost:8080";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** Rule-by-rule reasons, e.g. for a rejected password. */
    public readonly problems: string[] = [],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type ApiInit = Omit<RequestInit, "headers" | "body"> & {
  headers?: Record<string, string>;
  /** Serialized as the JSON request body. */
  json?: unknown;
  /** Session token, sent as a Bearer header. */
  token?: string | null;
};

export async function api<T>(path: string, init: ApiInit = {}): Promise<T> {
  const { headers: extra = {}, json, token, ...rest } = init;

  const res = await fetch(`${API_URL}${path}`, {
    cache: "no-store",
    ...rest,
    signal: rest.signal ?? AbortSignal.timeout(10_000),
    headers: {
      ...(await clientHeaders()),
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extra,
    },
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });

  if (!res.ok) {
    let message = `${rest.method ?? "GET"} ${path} failed with ${res.status}`;
    let problems: string[] = [];
    try {
      const body = (await res.json()) as { error?: string; problems?: string[] };
      if (body.error) message = body.error;
      if (Array.isArray(body.problems)) problems = body.problems;
    } catch {
      // Non-JSON error body; keep the generic message.
    }
    throw new ApiError(res.status, message, problems);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// Forward the browser's address and user agent so the API can rate-limit and
// audit the real client rather than the Next.js container. The API only trusts
// X-Forwarded-For from configured proxy ranges (TRUSTED_PROXY_CIDRS).
async function clientHeaders(): Promise<Record<string, string>> {
  try {
    const h = await headers();
    const out: Record<string, string> = {};
    const forwardedFor = h.get("x-forwarded-for");
    if (forwardedFor) out["X-Forwarded-For"] = forwardedFor;
    const userAgent = h.get("user-agent");
    if (userAgent) out["User-Agent"] = userAgent;
    return out;
  } catch {
    // Outside a request scope (e.g. build time) there is nothing to forward.
    return {};
  }
}
