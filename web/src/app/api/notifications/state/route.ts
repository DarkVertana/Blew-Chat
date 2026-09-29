import { api, ApiError } from "@/lib/api";
import { getSessionToken } from "@/lib/session";
import type { NotificationState } from "@/lib/notifications";

export async function GET() {
  const token = await getSessionToken();
  if (!token) return new Response(null, { status: 401 });
  try {
    const state = await api<NotificationState>("/api/notifications", { token });
    return Response.json({ user_id: state.user_id, settings: state.settings, subscribed: state.subscribed }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    return new Response(null, { status: err instanceof ApiError ? err.status : 503 });
  }
}
