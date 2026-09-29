"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { getSessionToken } from "@/lib/session";

export async function createNote(formData: FormData) {
  const token = await getSessionToken();
  if (!token) redirect("/login");

  const body = String(formData.get("body") ?? "").trim();
  if (!body) return;

  await api("/api/notes", { method: "POST", json: { body }, token });
  revalidatePath("/notes");
}
