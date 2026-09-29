import { api } from "./api";
import { getSessionToken } from "./session";

export type Profile = { name: string; about: string; image_version: string | null };

export async function getProfile(): Promise<Profile> {
  return api<Profile>("/api/profile", { token: await getSessionToken() });
}

