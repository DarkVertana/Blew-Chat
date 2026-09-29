import { getSessionToken } from "./session";

// Route handlers stream uploads instead of using the Server Action body cap.
// These cookie-authenticated routes enforce their own CSRF and session checks.
export async function forwardProfile(request: Request, image = false, botID?: number): Promise<Response> {
  if (botID !== undefined && (!Number.isSafeInteger(botID) || botID < 1)) return Response.json({error:"Not found"},{status:404});
  if (request.method !== "GET") {
    try {
      const origin = new URL(request.headers.get("origin") ?? "");
      if (!/^https?:$/.test(origin.protocol) || origin.host !== request.headers.get("host")) {
        return Response.json({ error: "invalid request origin" }, { status: 403 });
      }
    } catch {
      return Response.json({ error: "invalid request origin" }, { status: 403 });
    }
  }
  const token = await getSessionToken();
  if (!token) return Response.json({ error: "Please sign in again." }, { status: 401 });

  const headers = new Headers({ Authorization: `Bearer ${token}` });
  for (const name of ["content-type", "user-agent", "x-forwarded-for"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  try {
    const init: RequestInit & { duplex?: "half" } = {
      method: request.method,
      headers,
      cache: "no-store",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(60_000)]),
    };
    if (request.method === "PUT") {
      init.body = request.body;
      init.duplex = "half";
    }
    const result = await fetch(`${process.env.API_URL ?? "http://localhost:8080"}${botID === undefined ? "/api/profile" : `/api/bots/${botID}`}${image ? "/image" : ""}`, init);
    return new Response(result.body, {
      status: result.status,
      headers: {
        "Content-Type": result.headers.get("content-type") ?? "application/json",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json({ error: "Could not reach the API. Please try again." }, { status: 502 });
  }
}
