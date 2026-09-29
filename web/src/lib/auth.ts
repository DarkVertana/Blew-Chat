import { cache } from "react";
import { redirect } from "next/navigation";
import { api, ApiError } from "./api";
import { getSessionToken } from "./session";

export type User = { id: number; email: string; created_at: string; name: string; image_version: string | null };
export type Session = { token: string; expires_at: string; user: User };
export type SessionInfo = {
  id: number;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
  last_seen_at: string;
  current: boolean;
};
export type ActivityEntry = {
  occurred_at: string;
  action: string;
  method: string;
  path: string;
  status: number;
  ip: string | null;
  user_agent: string | null;
};

/** The signed-in user, validated against the API once per request. */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const token = await getSessionToken();
  if (!token) return null;
  try {
    return await api<User>("/api/auth/me", { token });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
});

/** Use at the top of any protected page. */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
