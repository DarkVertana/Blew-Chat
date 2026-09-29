"use client";
import Image from "next/image";

import Link from "next/link";
import { EngineBanner } from "@/components/engine-banner";
import { useNotifications } from "@/components/notification-provider";
import { useMemo, useState } from "react";
import { BellOff, EllipsisVertical, FileText, Image as ImageIcon, MessageSquarePlus, Mic, Plus, Search, X } from "lucide-react";
import { type Chat } from "@/lib/mock-chats";
import { Avatar } from "./avatar";
import { Ticks } from "./ticks";

type Filter = "all" | "unread" | "favourites" | "groups";
const filters: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "favourites", label: "Favourites" },
  { id: "groups", label: "Groups" },
];

const iconButton = "flex h-10 w-10 items-center justify-center rounded-full transition";

export function ChatListPanel({ title, selectedId, onSelect, items, onNew }: { title: string; selectedId: string | null; onSelect: (id: string) => void; items: (Chat & {imageURL?:string})[]; onNew:()=>void }) {
  const notifications = useNotifications();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [bannerOpen, setBannerOpen] = useState(true);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter((c) =>
        filter === "unread" ? (c.unread ?? 0) > 0 : filter === "favourites" ? Boolean(c.favourite) : filter === "groups" ? Boolean(c.group) : true,
      )
      .filter((c) => !q || c.name.toLowerCase().includes(q) || c.preview.toLowerCase().includes(q));
  }, [query, filter, items]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between px-4 pb-2 pt-4">
        <h1 className="text-[22px] font-bold tracking-tight">{title}</h1>
        <div className="flex items-center gap-1">
          <button type="button" title="Menu" aria-label="Menu" className={`${iconButton} text-wa-text hover:bg-wa-hover`}>
            <EllipsisVertical size={22} />
          </button>
          <button type="button" title="New chat" aria-label="New chat" onClick={onNew} className={`${iconButton} bg-wa-green text-black hover:brightness-110`}>
            <MessageSquarePlus size={20} />
          </button>
        </div>
      </header>
      <EngineBanner />

      <div className="px-4 pb-2">
        <label className="flex h-11 items-center gap-3 rounded-full bg-wa-input px-4">
          <Search size={18} className="shrink-0 text-wa-muted" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search or start a new chat"
            className="w-full bg-transparent text-[15px] text-wa-text outline-none placeholder:text-wa-muted"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
        {filters.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            aria-pressed={filter === id}
            className={`rounded-full border px-4 py-2 text-[15px] transition ${filter === id ? "border-wa-green bg-wa-green-deep text-wa-accent" : "border-wa-border text-wa-text hover:bg-wa-hover"}`}
          >
            {label}
          </button>
        ))}
        <button type="button" title="Add filter" aria-label="Add filter" className="flex h-[38px] w-[38px] items-center justify-center rounded-full border border-wa-border text-wa-text transition hover:bg-wa-hover">
          <Plus size={16} />
        </button>
      </div>

      {bannerOpen && notifications.permission !== "loading" && notifications.permission !== "granted" && (
        <div className="mx-3 mb-2 flex items-center gap-3 rounded-2xl bg-wa-green-deep px-4 py-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-wa-green/15 text-wa-accent">
            <BellOff size={22} />
          </div>
          <p className="flex-1 text-[15px] leading-snug">
            Message notifications are off in this browser.{" "}
            <Link href="/settings/notifications" className="font-medium text-wa-accent hover:underline">Turn on</Link>
          </p>
          <button type="button" onClick={() => setBannerOpen(false)} aria-label="Dismiss" className="rounded-full p-1 text-wa-text hover:bg-white/10">
            <X size={20} />
          </button>
        </div>
      )}

      <ul className="wa-scroll flex-1 overflow-y-auto">
        {visible.map((chat) => (
          <ChatListItem key={chat.id} chat={chat} active={chat.id === selectedId} onClick={() => onSelect(chat.id)} />
        ))}
        {visible.length === 0 && <li className="px-6 py-10 text-center text-sm text-wa-muted">No bots yet. Use New chat to create your AI coworker.</li>}
      </ul>
    </div>
  );
}

function ChatListItem({ chat, active, onClick }: { chat: Chat & {imageURL?:string}; active: boolean; onClick: () => void }) {
  const unread = chat.unread ?? 0;
  return (
    <li className="px-2 py-0.5">
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? "true" : undefined}
        className={`flex w-full items-center gap-4 rounded-2xl px-3 py-3 text-left transition ${active ? "bg-wa-elevated" : "hover:bg-wa-hover"}`}
      >
        {chat.imageURL ? <Image unoptimized src={chat.imageURL} alt="" width={52} height={52} className="h-[52px] w-[52px] rounded-full object-cover" /> : <Avatar initials={chat.initials} color={chat.color} size={52} />}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate text-[17px]">{chat.name}</span>
            <span className={`shrink-0 text-xs ${unread ? "text-wa-accent" : "text-wa-muted"}`}>{chat.time}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[15px] text-wa-muted">
            {chat.lastFromMe && <Ticks status={chat.status} />}
            {chat.attachment === "document" && <FileText size={17} className="shrink-0" />}
            {chat.attachment === "image" && <ImageIcon size={17} className="shrink-0" />}
            {chat.attachment === "audio" && <Mic size={17} className="shrink-0" />}
            <span className="truncate">
              <Preview text={chat.preview} />
            </span>
            {unread > 0 && (
              <span className="ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-wa-green px-1.5 text-xs font-medium text-black">
                {unread}
              </span>
            )}
          </div>
        </div>
      </button>
    </li>
  );
}

/** Renders *text* as bold, like WhatsApp does in previews. */
function Preview({ text }: { text: string }) {
  const parts = text.split(/(\*[^*]+\*)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.length > 2 && part.startsWith("*") && part.endsWith("*") ? (
          <strong key={i} className="font-semibold text-wa-text/90">{part.slice(1, -1)}</strong>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}
