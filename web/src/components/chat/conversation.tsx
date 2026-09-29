"use client";
import {MessageMarkdown} from "./message-content";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowLeft, EllipsisVertical, Lock, Mic, Phone, Plus, Search, SendHorizontal, Smile, Video } from "lucide-react";
import { useSetting } from "@/lib/local-settings";
import { messagesFor, type Chat, type Message } from "@/lib/mock-chats";
import { DOODLES_KEY, WALLPAPER_KEY, wallpaperById } from "@/lib/wallpaper";
import { Avatar } from "./avatar";
import { ContactInfo } from "./contact-info";
import { Ticks } from "./ticks";

const iconButton = "flex h-10 w-10 items-center justify-center rounded-full text-wa-text transition hover:bg-wa-hover";

function nowTime() {
  return new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

// Mounted with key={chat.id} by the shell, so state resets per conversation.
export function Conversation({ chat, appName, onBack }: { chat: Chat; appName: string; onBack: () => void }) {
  const [messages, setMessages] = useState<Message[]>(() => messagesFor(chat.id));
  const [draft, setDraft] = useState("");
  const [infoOpen, setInfoOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  // Wallpaper from Settings → Chats: a colour per theme plus the doodle tile.
  const [wallpaperId] = useSetting<string>(WALLPAPER_KEY, "default");
  const [doodles] = useSetting<boolean>(DOODLES_KEY, true);
  const wallpaper = wallpaperById(wallpaperId);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  useEffect(() => {
    if (!infoOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setInfoOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [infoOpen]);

  function send() {
    const text = draft.trim();
    if (!text) return;
    const message: Message = { id: crypto.randomUUID(), from: "me", text, time: nowTime(), status: "sent" };
    setMessages((prev) => [...prev, message]);
    setDraft("");
    // Frontend only: pretend the server delivered it.
    setTimeout(() => {
      setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, status: "delivered" } : m)));
    }, 800);
  }

  const subtitle = chat.group ? "click here for group info" : chat.online ? "online" : "click here for contact info";

  return (
    <div className="flex h-full">
      {/* The info panel takes the conversation's place until the layout is wide enough for both. */}
      <div className={`${infoOpen ? "hidden min-[1400px]:flex" : "flex"} h-full min-w-0 flex-1 flex-col`}>
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-wa-border bg-wa-panel px-3 sm:px-4">
          <button type="button" onClick={onBack} aria-label="Back" className={`${iconButton} md:hidden`}>
            <ArrowLeft size={22} />
          </button>
          <button
            type="button"
            onClick={() => setInfoOpen(true)}
            aria-expanded={infoOpen}
            className="-mx-1 flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1 py-1 text-left transition hover:bg-wa-hover"
          >
            <Avatar initials={chat.initials} color={chat.color} size={40} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[16px]">{chat.name}</p>
              <p className="truncate text-xs text-wa-muted">{subtitle}</p>
            </div>
          </button>
          <div className="flex items-center">
            {[
              { label: "Video call", Icon: Video },
              { label: "Voice call", Icon: Phone },
              { label: "Search", Icon: Search },
              { label: "Menu", Icon: EllipsisVertical },
            ].map(({ label, Icon }) => (
              <button key={label} type="button" title={label} aria-label={label} className={iconButton}>
                <Icon size={20} />
              </button>
            ))}
          </div>
        </header>

        <div
          className={`wa-scroll wa-canvas flex-1 overflow-y-auto px-[6%] py-4 ${doodles ? "wa-doodles" : ""}`}
          style={{ "--wp-light": wallpaper.light, "--wp-dark": wallpaper.dark } as CSSProperties}
        >
          <div className="mx-auto mb-3 w-fit rounded-lg bg-wa-card px-3 py-1.5 text-xs text-wa-muted shadow-sm">Today</div>
          <p className="mx-auto mb-5 max-w-md rounded-lg bg-[#fdf4c5] px-3 py-2 text-center text-xs leading-relaxed text-[#5b5b3a] shadow-sm dark:bg-[#1f2b2a] dark:text-[#d1c48f]">
            <Lock size={12} className="mr-1 inline-block align-[-1px]" />
            Messages are end-to-end encrypted. No one outside of this chat, not even {appName}, can read or listen to them.
          </p>
          <ul>
            {messages.map((m, i) => (
              <Bubble key={m.id} message={m} accent={chat.color} first={i === 0 || messages[i - 1].from !== m.from} />
            ))}
          </ul>
          <div ref={endRef} />
        </div>

        <footer className="flex shrink-0 items-center gap-1 bg-wa-panel px-3 py-2.5 sm:px-4">
          <button type="button" title="Attach" aria-label="Attach" className={iconButton}>
            <Plus size={24} />
          </button>
          <button type="button" title="Emoji" aria-label="Emoji" className={iconButton}>
            <Smile size={24} />
          </button>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Type a message"
            aria-label="Type a message"
            className="mx-1 h-11 min-w-0 flex-1 rounded-full bg-wa-input px-4 text-[15px] text-wa-text outline-none placeholder:text-wa-muted"
          />
          {draft.trim() ? (
            <button type="button" onClick={send} title="Send" aria-label="Send" className="flex h-11 w-11 items-center justify-center rounded-full bg-wa-green text-black transition hover:brightness-110">
              <SendHorizontal size={20} />
            </button>
          ) : (
            <button type="button" title="Voice message" aria-label="Voice message" className={iconButton}>
              <Mic size={24} />
            </button>
          )}
        </footer>
      </div>

      {infoOpen && <ContactInfo chat={chat} onClose={() => setInfoOpen(false)} />}
    </div>
  );
}

// Emoji-only messages render large, like WhatsApp. Built with the RegExp
// constructor so the Unicode property escapes do not depend on the TS target.
const emojiOnly = new RegExp("^(?:\\p{Extended_Pictographic}|\\p{Regional_Indicator}|\\p{Emoji_Modifier}|\\u200d|\\ufe0f|\\u20e3|\\s)+$", "u");
const emojiGlyph = new RegExp("\\p{Extended_Pictographic}|\\p{Regional_Indicator}{2}", "gu");
function isJumbo(text: string) {
  return emojiOnly.test(text) && (text.match(emojiGlyph)?.length ?? 0) <= 3;
}

/**
 * One message. `first` marks the start of a run from one sender: it gets the
 * tail and a larger gap above, later bubbles in the run sit close together.
 */
export function Bubble({ message, accent, first, children, content, hideReaction=false }: { message: Message; accent: string; first: boolean; children?:ReactNode; content?:ReactNode; hideReaction?:boolean }) {
  const mine = message.from === "me";
  const jumbo = isJumbo(message.text);
  const quoteColor = message.quote?.author === "You" ? "var(--wa-accent)" : accent;
  const meta = (
    <span className="inline-flex items-center gap-1 text-[11px] leading-[15px] text-wa-muted">
      {message.time}
      {mine && <Ticks status={message.status} size={15} />}
    </span>
  );
  return (
    <li className={`group flex items-center gap-2 ${mine ? "justify-end" : "justify-start"} ${first ? "mt-3 first:mt-0" : "mt-0.5"}`}>
      {mine && !hideReaction && <ReactButton />}
      <div
        className={`relative mx-2 max-w-[75%] rounded-[7.5px] px-[9px] pt-[6px] pb-[8px] text-[14.2px] leading-[19px] shadow-[0_1px_0.5px_rgba(11,20,26,0.13)] sm:max-w-[65%] ${
          mine ? "bg-wa-out" : "bg-wa-in"
        } ${first ? (mine ? "rounded-tr-none" : "rounded-tl-none") : ""}`}
      >
        {first && <Tail mine={mine} />}
        {message.quote && (
          <div
            className="mb-1.5 overflow-hidden rounded-[7.5px] border-l-4 bg-black/[0.06] py-1.5 pl-2.5 pr-3 dark:bg-white/[0.06]"
            style={{ borderColor: quoteColor }}
          >
            <p className="truncate text-[12.8px] font-semibold leading-[22px]" style={{ color: quoteColor }}>
              {message.quote.author}
            </p>
            <p className="line-clamp-3 text-[13.2px] leading-[20px] text-wa-text/80">{message.quote.text}</p>
          </div>
        )}
        {jumbo ? (
          <>
            <p className="whitespace-pre-wrap break-words text-[26px] leading-[34px]">{message.text}</p>
            <div className="-mb-1 mt-0.5 flex justify-end">{meta}</div>
          </>
        ) : (
          <>
            {content||<MessageMarkdown text={message.text}/>}
            <span className="float-right -mb-[5px] ml-2 mt-[5px]">{meta}</span>
          </>
        )}
        {children && <div className="clear-both pt-2">{children}</div>}
      </div>
      {!mine && !hideReaction && <ReactButton />}
    </li>
  );
}

/** The pointed corner on the first bubble of a run, drawn with a soft shadow like the bubble itself. */
function Tail({ mine }: { mine: boolean }) {
  const d = mine ? "M5.2 0H0v11.2l6.5-8.6C7.5 1.2 7 0 5.2 0z" : "M1.5 2.6 8 11.2V0H2.8C1 0 .5 1.2 1.5 2.6z";
  return (
    <svg viewBox="0 0 8 13" width="8" height="13" aria-hidden className={`absolute top-0 ${mine ? "-right-2 text-wa-out" : "-left-2 text-wa-in"}`}>
      <path d={d} transform="translate(0 1)" fill="#0b141a" opacity="0.13" />
      <path d={d} fill="currentColor" />
    </svg>
  );
}

/** The react-with-emoji affordance that appears beside a bubble on hover. */
function ReactButton() {
  return (
    <button
      type="button"
      title="React"
      aria-label="React"
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-wa-panel text-wa-muted opacity-0 shadow-sm transition hover:text-wa-text focus-visible:opacity-100 group-hover:opacity-100"
    >
      <Smile size={18} />
    </button>
  );
}
