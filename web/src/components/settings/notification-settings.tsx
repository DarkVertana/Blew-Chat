"use client";

import { useNotifications } from "@/components/notification-provider";
import type { NotificationPreferences } from "@/lib/notifications";
import { PanelHeader, SectionLabel, SettingsRow } from "./primitives";
import { Toggle } from "./toggle";

export function NotificationSettings() {
  const n = useNotifications();
  const toggle = (key: keyof NotificationPreferences, label: string) => (
    <Toggle checked={n.settings[key]} onChange={(value) => n.update(key, value)} disabled={n.busy} label={label} />
  );
  const button = "rounded-full bg-wa-green px-5 py-2.5 text-sm font-medium text-black disabled:opacity-50";
  return (
    <div className="wa-scroll flex h-full flex-col overflow-y-auto pb-8">
      <PanelHeader title="Notifications" backHref="/settings" />
      <section className="mx-5 mt-4 space-y-3 rounded-2xl border border-wa-border p-4">
        <h2 className="font-medium">This browser</h2>
        <p className="text-sm text-wa-muted">
          {n.permission === "loading" ? "Checking browser support…" : n.permission === "unsupported"
            ? "Browser notifications need HTTPS (or localhost) and Web Push support. On iPhone or iPad, add this app to your Home Screen first."
            : n.permission === "denied" ? "Notifications are blocked. Open this site's browser permissions and allow notifications, then return here."
            : n.enabled ? "Browser notifications are enabled."
            : "Enable notifications and choose Allow when your browser asks."}
        </p>
        {n.permission !== "unsupported" && n.permission !== "loading" && (
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={n.busy} onClick={n.enabled ? n.disable : n.enable} className={button}>
              {n.busy ? "Please wait…" : n.enabled ? "Disable in this browser" : "Enable browser notifications"}
            </button>
            {n.enabled && <button type="button" disabled={n.busy} onClick={n.test} className="rounded-full border border-wa-border px-5 py-2.5 text-sm disabled:opacity-50">Send test notification</button>}
          </div>
        )}
        {n.error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{n.error}</p>}
        {n.message && <p role="status" className="text-sm text-wa-accent">{n.message}</p>}
        <p className="text-xs text-wa-muted">Preferences are saved to your account. Browser permission is enabled separately on each device.</p>
      </section>
      <SectionLabel>Messages</SectionLabel>
      <SettingsRow title="Message notifications" subtitle="Show notifications for new messages" trailing={toggle("messages", "Message notifications")} />
      <SettingsRow title="Show previews" subtitle="Include the message text in notifications" trailing={toggle("previews", "Show previews")} />
      <SettingsRow title="Sounds" subtitle="Allow notification sounds; your browser and system settings control playback" trailing={toggle("sounds", "Sounds")} />
      <SectionLabel>Groups and status</SectionLabel>
      <SettingsRow title="Group notifications" trailing={toggle("groups", "Group notifications")} />
      <SettingsRow title="Status updates" subtitle="Get notified when contacts post a status" trailing={toggle("status", "Status updates")} />
      <p className="mt-6 px-5 text-sm text-wa-muted">You can test browser delivery now. Incoming message, group and status alerts will become available when live messaging is connected.</p>
    </div>
  );
}
