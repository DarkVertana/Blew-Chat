"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import type { Session } from "@/lib/auth";
import { clearSessionCookie, getSessionToken, setSessionCookie } from "@/lib/session";

export type AuthFormState = { error?: string; problems?: string[]; success?: string };

function failure(err: unknown): AuthFormState {
  if (err instanceof ApiError) return { error: err.message, problems: err.problems };
  return { error: "Could not reach the API. Try again." };
}

async function authenticate(
  path: "/api/auth/login" | "/api/auth/register",
  formData: FormData,
): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Email and password are required." };

  let session: Session;
  try {
    session = await api<Session>(path, { method: "POST", json: { email, password } });
  } catch (err) {
    return failure(err);
  }

  await setSessionCookie(session.token, session.expires_at);
  redirect("/");
}

export async function login(_prev: AuthFormState, formData: FormData) {
  return authenticate("/api/auth/login", formData);
}

export async function register(_prev: AuthFormState, formData: FormData) {
  return authenticate("/api/auth/register", formData);
}

export async function logout(): Promise<AuthFormState> {
  const token = await getSessionToken();
  if (token) {
    try {
      await api("/api/auth/logout", { method: "POST", token });
    } catch (err) {
      // An expired/revoked token is already signed out. Other failures must
      // preserve the cookie so the user can retry server-side revocation.
      if (!(err instanceof ApiError && err.status === 401)) return failure(err);
    }
  }
  await clearSessionCookie();
  redirect("/login");
}

/** Revokes every session, including this one. */
export async function logoutAll(): Promise<AuthFormState> {
  const token = await getSessionToken();
  if (!token) return { error: "Sign in again to sign out other devices." };
  if (token) {
    try {
      await api("/api/auth/logout-all", { method: "POST", token });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        return { error: "Your session expired. Sign in again to sign out other devices." };
      }
      return failure(err);
    }
  }
  await clearSessionCookie();
  redirect("/login");
}

export async function revokeSession(formData: FormData) {
  const token = await getSessionToken();
  if (!token) redirect("/login");
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return;
  try {
    await api(`/api/auth/sessions/${id}`, { method: "DELETE", token });
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 404)) throw err;
  }
  revalidatePath("/settings/account");
}

export async function changePassword(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const token = await getSessionToken();
  if (!token) redirect("/login");

  const current = String(formData.get("current_password") ?? "");
  const next = String(formData.get("new_password") ?? "");
  const confirm = String(formData.get("confirm_password") ?? "");
  if (!current || !next) return { error: "Both passwords are required." };
  if (next !== confirm) return { error: "New passwords do not match." };

  try {
    await api("/api/auth/password", {
      method: "POST",
      token,
      json: { current_password: current, new_password: next },
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/settings/account");
  return { success: "Password updated. All other sessions were signed out." };
}
