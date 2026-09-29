"use client";

import Link from "next/link";
import { EngineBanner } from "@/components/engine-banner";
import type { User } from "@/lib/auth";
import { displayName } from "@/lib/app";
import { useState } from "react";
import { Bell, Cpu, CircleUserRound, KeyRound, LifeBuoy, Lightbulb, Lock, LogOut, MessageSquareText, Search, UserRound, X, type LucideIcon } from "lucide-react";
import { LogoutForm } from "@/components/logout-form";
import { useNotifications } from "@/components/notification-provider";
import { SettingsRow } from "./primitives";

const rows: { href: string; icon: LucideIcon; title: string; subtitle: string }[] = [
  { href: "/settings/profile", icon: CircleUserRound, title: "Profile", subtitle: "Name, profile picture, about" },
  { href: "/settings/account", icon: KeyRound, title: "Account", subtitle: "Security notifications, account info" },
  { href: "/settings/privacy", icon: Lock, title: "Privacy", subtitle: "Blocked contacts, disappearing messages" },
  { href: "/settings/chats", icon: MessageSquareText, title: "Chats", subtitle: "Theme, wallpaper, chat settings" },
  { href: "/settings/notifications", icon: Bell, title: "Notifications", subtitle: "Message notifications" },
  { href: "/settings/engine", icon: Cpu, title: "Engine", subtitle: "AI providers, subscription login, API keys" },
  { href: "/settings/help", icon: LifeBuoy, title: "Help", subtitle: "Help center, contact us, privacy policy" },
];

export function SettingsRoot({ user }: { user: User }) {
  const notifications = useNotifications();
  const [query, setQuery] = useState("");
  const [tipOpen, setTipOpen] = useState(true);
  const q = query.trim().toLowerCase();
  const visible = rows.filter((r) => !q || r.title.toLowerCase().includes(q) || r.subtitle.toLowerCase().includes(q));

  return (
    <div className="wa-scroll flex h-full flex-col overflow-y-auto">
      <header className="flex h-[76px] shrink-0 items-center px-5">
        <h1 className="truncate text-[26px] font-medium tracking-tight">Settings</h1>
      </header>
      <EngineBanner />

      <div className="px-5">
        <label className="flex h-12 items-center gap-3 rounded-full border border-wa-border bg-wa-bg px-4 transition focus-within:border-wa-green">
          <Search size={20} className="shrink-0 text-wa-muted" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="w-full bg-transparent text-[17px] text-wa-text outline-none placeholder:text-wa-muted"
          />
        </label>
      </div>

      {tipOpen && !q && notifications.permission !== "loading" && notifications.permission !== "granted" && (
        <div className="mx-5 mt-5 flex items-start gap-5 rounded-2xl border border-wa-border px-5 py-5">
          <Lightbulb size={40} strokeWidth={1.25} className="mt-2 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <p className="text-[17px] font-medium">Choose your notifications</p>
              <button
                type="button"
                onClick={() => setTipOpen(false)}
                aria-label="Dismiss"
                className="-mr-2 -mt-1 rounded-full p-1 text-wa-text transition hover:bg-wa-hover"
              >
                <X size={22} />
              </button>
            </div>
            <p className="mt-1 text-[16px] leading-relaxed text-wa-text/90">
              Get notifications for messages, groups or your status.{" "}
              <Link href="/settings/notifications" className="font-medium text-wa-accent hover:underline">
                Choose now
              </Link>
            </p>
          </div>
        </div>
      )}

      {!q && (
        <div className="mt-10 flex flex-col items-center">
          <div className="relative rounded-full border border-wa-border bg-wa-card px-6 py-2.5 text-[17px] shadow-md">
            Current mood
            <span
              aria-hidden
              className="absolute left-1/2 top-full h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border-b border-r border-wa-border bg-wa-card"
            />
          </div>
          <Link
            href="/settings/profile"
            aria-label="Edit profile"
            className="relative mt-5 flex h-32 w-32 items-center justify-center rounded-full bg-orange-100 text-orange-800 transition hover:brightness-95 dark:bg-orange-950/60 dark:text-orange-300"
          >
            {user.image_version ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/profile/image?v=${encodeURIComponent(user.image_version)}`} alt="Your profile" className="h-full w-full rounded-full object-cover" />
            ) : <UserRound size={56} strokeWidth={1.25} fill="currentColor" aria-hidden />}
            <span className="absolute left-10 top-1 h-2.5 w-2.5 rounded-full bg-wa-card shadow" aria-hidden />
          </Link>
          <p className="mt-3 px-5 text-center text-lg font-medium break-words">{user.name || displayName(user.email)}</p>
        </div>
      )}

      <ul className="mt-8 pb-6">
        {visible.map((r) => (
          <li key={r.href}>
            <SettingsRow href={r.href} icon={r.icon} title={r.title} subtitle={r.subtitle} />
          </li>
        ))}
        {visible.length === 0 && <li className="px-5 py-8 text-center text-[15px] text-wa-muted">No settings found</li>}
        {!q && (
          <li className="mx-2 flex items-center gap-6 rounded-2xl px-3 transition hover:bg-wa-hover">
            <LogOut size={24} strokeWidth={1.6} className="shrink-0 text-red-600 dark:text-red-400" aria-hidden />
            <LogoutForm buttonClassName="py-4 text-left text-[17px] text-red-600 disabled:opacity-60 dark:text-red-400" />
          </li>
        )}
      </ul>
    </div>
  );
}
