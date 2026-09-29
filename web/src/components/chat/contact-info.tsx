"use client";

import { useState } from "react";
import {
  Bell,
  ChevronRight,
  CircleMinus,
  Download,
  FileText,
  Heart,
  Image as ImageIcon,
  Images,
  Link2,
  ListPlus,
  Lock,
  LogOut,
  Pencil,
  Phone,
  Search,
  ShieldCheck,
  Star,
  ThumbsDown,
  Timer,
  Trash,
  Video,
  X,
  type LucideIcon,
} from "lucide-react";
import { SettingsRow } from "@/components/settings/primitives";
import { Toggle } from "@/components/settings/toggle";
import { mediaFor, type Chat, type MediaItem } from "@/lib/mock-chats";
import { Avatar } from "./avatar";

const iconButton = "flex h-10 w-10 items-center justify-center rounded-full text-wa-text transition hover:bg-wa-hover";

const actions: { label: string; icon: LucideIcon }[] = [
  { label: "Voice", icon: Phone },
  { label: "Video", icon: Video },
  { label: "Search", icon: Search },
];

const noop = () => {};

/**
 * Contact info (or Group info) for the open conversation, WhatsApp Web style.
 * Sits beside the conversation on wide screens and replaces it otherwise; the
 * conversation mounts it, so it resets with the chat.
 */
export function ContactInfo({ chat, onClose }: { chat: Chat; onClose: () => void }) {
  const [favourite, setFavourite] = useState(Boolean(chat.favourite));
  const [muted, setMuted] = useState(false);
  const media = mediaFor(chat.id);
  const title = chat.group ? "Group info" : "Contact info";
  const chevron = <ChevronRight size={20} className="shrink-0 text-wa-muted" aria-hidden />;

  return (
    <aside
      aria-label={title}
      className="flex h-full w-full shrink-0 flex-col bg-wa-panel min-[1400px]:w-[420px] min-[1400px]:border-l min-[1400px]:border-wa-border"
    >
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-wa-border px-3 sm:px-4">
        <button type="button" onClick={onClose} title="Close" aria-label="Close" className={iconButton}>
          <X size={22} />
        </button>
        <h2 className="min-w-0 flex-1 truncate text-[16px]">{title}</h2>
        <button type="button" title="Edit" aria-label="Edit" className={iconButton}>
          <Pencil size={20} />
        </button>
      </header>

      <div className="wa-scroll flex-1 overflow-y-auto pb-4">
        <section className="flex flex-col items-center px-5 pb-7 pt-8 text-center">
          <Avatar initials={chat.initials} color={chat.color} size={200} />
          <p className="mt-5 text-[22px] leading-tight">{chat.name}</p>
          <p className="mt-1.5 text-[16px] text-wa-muted">
            {chat.group ? `Group · ${chat.members ?? 0} members` : (chat.phone ?? chat.name)}
          </p>
          <ul className="mt-6 flex items-start gap-6">
            {actions.map(({ label, icon: Icon }) => (
              <li key={label} className="flex w-20 flex-col items-center gap-2">
                <button
                  type="button"
                  title={label}
                  className="flex h-20 w-20 items-center justify-center rounded-full bg-wa-elevated text-wa-text transition hover:bg-wa-hover"
                >
                  <Icon size={24} strokeWidth={1.6} />
                </button>
                <span className="text-sm">{label}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="border-t border-wa-border px-5 py-4">
          <p className="text-[15px] text-wa-muted">{chat.group ? "Group description" : "About"}</p>
          <p className="mt-1 text-[17px] leading-snug">{chat.about ?? "Available"}</p>
        </section>

        <section className="border-t border-wa-border py-2">
          <SettingsRow
            icon={Images}
            title="Media, links and docs"
            onClick={noop}
            trailing={
              <span className="flex shrink-0 items-center gap-1 text-[15px] text-wa-muted">
                {chat.media ?? 0}
                {chevron}
              </span>
            }
          />
          {media.length > 0 && (
            <ul className="mx-5 mb-3 grid grid-cols-4 gap-2">
              {media.map((item) => (
                <li key={item.id}>
                  <MediaTile item={item} />
                </li>
              ))}
            </ul>
          )}
          <SettingsRow icon={Star} title="Starred messages" onClick={noop} trailing={chevron} />
          <SettingsRow icon={Bell} title="Mute notifications" trailing={<Toggle checked={muted} onChange={setMuted} label="Mute notifications" />} />
          <SettingsRow icon={Timer} title="Disappearing messages" subtitle="Off" onClick={noop} trailing={chevron} />
          <SettingsRow icon={ShieldCheck} title="Advanced chat privacy" subtitle="Off" onClick={noop} trailing={chevron} />
          <SettingsRow icon={Lock} title="Encryption" subtitle="Messages are end-to-end encrypted. Click to verify." onClick={noop} />
        </section>

        <section className="border-t border-wa-border py-2">
          <SettingsRow icon={Heart} title={favourite ? "Remove from favourites" : "Add to favourites"} onClick={() => setFavourite((v) => !v)} />
          <SettingsRow icon={ListPlus} title="Add to list" onClick={noop} />
          <SettingsRow icon={Download} title="Export chat" onClick={noop} />
          <SettingsRow icon={CircleMinus} title="Clear chat" onClick={noop} danger />
          {chat.group && <SettingsRow icon={LogOut} title="Exit group" onClick={noop} danger />}
          <SettingsRow icon={ThumbsDown} title={chat.group ? "Report group" : `Report ${chat.name}`} onClick={noop} danger />
          <SettingsRow icon={Trash} title="Delete chat" onClick={noop} danger />
        </section>
      </div>
    </aside>
  );
}

/** Placeholder thumbnail: a tinted square for photos, an icon plus type for documents and links. */
function MediaTile({ item }: { item: MediaItem }) {
  if (item.kind === "image") {
    return (
      <div
        role="img"
        aria-label="Photo"
        title="Photo"
        className="flex aspect-square items-center justify-center rounded-lg text-white/80"
        style={{ background: `linear-gradient(135deg, ${item.tint}b3, ${item.tint})` }}
      >
        <ImageIcon size={26} strokeWidth={1.5} />
      </div>
    );
  }
  const Icon = item.kind === "document" ? FileText : Link2;
  return (
    <div
      role="img"
      aria-label={item.label}
      title={item.label}
      className="flex aspect-square flex-col items-center justify-center gap-1.5 rounded-lg bg-wa-elevated text-wa-muted"
    >
      <Icon size={26} strokeWidth={1.5} />
      <span className="max-w-full truncate px-1.5 text-[11px] font-medium">{item.label}</span>
    </div>
  );
}
