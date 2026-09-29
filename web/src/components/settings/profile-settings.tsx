"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Camera, UserRound } from "lucide-react";
import { displayName } from "@/lib/app";
import type { Profile } from "@/lib/profile";
import { PanelHeader, SettingsRow } from "./primitives";

async function save(url: string, init: RequestInit) {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? "Could not save your profile. Please try again.");
  }
  return response;
}

export function ProfileSettings({ email, profile }: { email: string; profile: Profile }) {
  const router = useRouter();
  const [name, setName] = useState(profile.name || displayName(email));
  const [about, setAbout] = useState(profile.about);
  const [imageVersion, setImageVersion] = useState(profile.image_version);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [imageError, setImageError] = useState("");
  const [imageMessage, setImageMessage] = useState("");

  async function saveText(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");
    try {
      await save("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, about }),
      });
      setMessage("Profile saved.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your profile.");
    } finally {
      setSaving(false);
    }
  }

  async function uploadImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImageError("");
    setImageMessage("");
    if (file.size > 5 * 1024 * 1024) {
      setImageError("Choose an image of 5 MB or smaller.");
      return;
    }
    setUploading(true);
    try {
      const response = await save("/api/profile/image", { method: "PUT", body: file });
      const result = await response.json();
      setImageVersion(result.image_version);
      setImageMessage("Profile image saved.");
      router.refresh();
    } catch (err) {
      setImageError(err instanceof Error ? err.message : "Could not upload your image.");
    } finally {
      setUploading(false);
    }
  }

  async function removeImage() {
    setUploading(true);
    setImageError("");
    setImageMessage("");
    try {
      await save("/api/profile/image", { method: "DELETE" });
      setImageVersion(null);
      setImageMessage("Profile image removed.");
      router.refresh();
    } catch (err) {
      setImageError(err instanceof Error ? err.message : "Could not remove your image.");
    } finally {
      setUploading(false);
    }
  }

  const inputClass = "mt-2 w-full rounded-xl border border-wa-border bg-wa-bg px-3 py-3 text-[17px] outline-none focus:border-wa-green disabled:opacity-60";
  return (
    <div className="wa-scroll flex h-full flex-col overflow-y-auto">
      <PanelHeader title="Profile" backHref="/settings" />
      <div className="mt-6 flex flex-col items-center gap-3 px-5">
        <div className="flex h-32 w-32 items-center justify-center overflow-hidden rounded-full bg-orange-100 text-orange-800 dark:bg-orange-950/60 dark:text-orange-300">
          {imageVersion ? (
            // Private same-origin image; no Next image optimizer/cache.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/profile/image?v=${encodeURIComponent(imageVersion)}`} alt="Your profile" className="h-full w-full object-cover" />
          ) : <UserRound size={56} strokeWidth={1.25} fill="currentColor" aria-hidden />}
        </div>
        <label className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-wa-accent hover:bg-wa-hover focus-within:ring-2 focus-within:ring-wa-green">
          <Camera size={20} aria-hidden />
          {uploading ? "Saving image…" : "Change profile image"}
          <input type="file" accept="image/jpeg,image/png" aria-label="Upload profile image" className="sr-only" disabled={uploading} onChange={uploadImage} />
        </label>
        <p className="text-center text-xs text-wa-muted">JPEG or PNG · up to 5 MB and 4096 × 4096 pixels</p>
        {imageVersion && <button type="button" disabled={uploading} onClick={removeImage} className="text-sm text-red-600 disabled:opacity-60">Remove image</button>}
        {imageError && <p role="alert" className="text-sm text-red-600">{imageError}</p>}
        {imageMessage && <p role="status" className="text-sm text-wa-accent">{imageMessage}</p>}
      </div>
      <form onSubmit={saveText} className="mt-8 space-y-6 px-5 pb-8">
        <label className="block text-[15px] text-wa-accent">
          Your name
          <input name="name" value={name} onChange={(event) => setName(event.target.value)} required disabled={saving} autoComplete="name" className={`${inputClass} text-wa-text`} />
        </label>
        <p className="text-[14px] text-wa-muted">This name will be visible to your contacts.</p>
        <div>
          <p className="text-[15px] text-wa-accent">Email</p>
          <SettingsRow title={email} />
        </div>
        <label className="block text-[15px] text-wa-accent">
          About
          <textarea name="about" value={about} onChange={(event) => setAbout(event.target.value)} disabled={saving} rows={6} placeholder="Tell people about yourself…" className={`${inputClass} resize-y text-wa-text`} />
          <span className="mt-1 block text-xs text-wa-muted">Write as much as you like. No character limit.</span>
        </label>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        {message && <p role="status" className="text-sm text-wa-accent">{message}</p>}
        <button type="submit" disabled={saving} className="rounded-full bg-wa-green px-6 py-3 font-medium text-black disabled:opacity-60">{saving ? "Saving…" : "Save profile"}</button>
      </form>
    </div>
  );
}
