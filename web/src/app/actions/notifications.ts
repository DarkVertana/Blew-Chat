"use server";

import { api, ApiError } from "@/lib/api";
import { getSessionToken } from "@/lib/session";
import type { NotificationPreferences, NotificationState } from "@/lib/notifications";

async function request<T>(path: string, method = "GET", json?: unknown): Promise<{ data: T; error?: never } | { error: string; data?: never }> {
  const token = await getSessionToken();
  if (!token) return { error: "Please sign in again." };
  try {
    return { data: await api<T>(path, { method, token, json }) };
  } catch (err) {
    return { error: err instanceof ApiError ? err.message : "Could not reach the server. Please try again." };
  }
}

export async function getNotificationState() {
  return request<NotificationState>("/api/notifications");
}

export async function saveNotificationPreferences(settings: NotificationPreferences) {
  return request<void>("/api/notifications", "PUT", settings);
}

export async function subscribeBrowser(subscription: PushSubscriptionJSON) {
  return request<void>("/api/notifications/subscription", "PUT", subscription);
}

export async function unsubscribeBrowser() {
  return request<void>("/api/notifications/subscription", "DELETE");
}

export async function sendTestNotification() {
  return request<{ sent: number }>("/api/notifications/test", "POST");
}
