"use client";

import { useState } from "react";
import { useSetting } from "@/lib/local-settings";
import { applyTheme, THEME_KEY, themeLabels, type ThemeSetting } from "@/lib/theme";
import { DOODLES_KEY, WALLPAPER_KEY, wallpaperById, wallpapers } from "@/lib/wallpaper";
import { Chevron, PanelHeader, SectionLabel, SettingsRow } from "./primitives";
import { Toggle } from "./toggle";

export function ChatsSettings() {
  const [theme, setTheme] = useSetting<ThemeSetting>(THEME_KEY, "system");
  const [wallpaperId, setWallpaperId] = useSetting<string>(WALLPAPER_KEY, "default");
  const [doodles, setDoodles] = useSetting<boolean>(DOODLES_KEY, true);
  const [spellCheck, setSpellCheck] = useSetting<boolean>("blew:spell-check", true);
  const [emojiReplace, setEmojiReplace] = useSetting<boolean>("blew:emoji-replace", true);
  const [enterIsSend, setEnterIsSend] = useSetting<boolean>("blew:enter-is-send", true);
  const [themeOpen, setThemeOpen] = useState(false);
  const [wallpaperOpen, setWallpaperOpen] = useState(false);

  return (
    <div className="wa-scroll flex h-full flex-col overflow-y-auto">
      <PanelHeader title="Chats" backHref="/settings" />

      <SectionLabel>Display</SectionLabel>
      <SettingsRow title="Theme" subtitle={themeLabels[theme]} onClick={() => setThemeOpen(true)} trailing={<Chevron />} />
      <SettingsRow
        title="Wallpaper"
        subtitle={`${wallpaperById(wallpaperId).label}${doodles ? " · doodles" : ""}`}
        onClick={() => setWallpaperOpen(true)}
        trailing={<Chevron />}
      />

      <SectionLabel>Chat settings</SectionLabel>
      <SettingsRow title="Media upload quality" onClick={() => {}} trailing={<Chevron />} />
      <SettingsRow title="Media auto-download" onClick={() => {}} trailing={<Chevron />} />
      <SettingsRow
        title="Spell check"
        subtitle="Check spelling while typing"
        trailing={<Toggle checked={spellCheck} onChange={setSpellCheck} label="Spell check" />}
      />
      <SettingsRow
        title="Replace text with emoji"
        subtitle="Emoji will replace specific text as you type"
        trailing={<Toggle checked={emojiReplace} onChange={setEmojiReplace} label="Replace text with emoji" />}
      />
      <SettingsRow
        title="Enter is send"
        subtitle="Enter key will send your message"
        trailing={<Toggle checked={enterIsSend} onChange={setEnterIsSend} label="Enter is send" />}
      />

      {themeOpen && (
        <ThemeDialog
          value={theme}
          onCancel={() => setThemeOpen(false)}
          onSave={(next) => {
            setTheme(next);
            applyTheme(next);
            setThemeOpen(false);
          }}
        />
      )}
      {wallpaperOpen && (
        <WallpaperDialog
          value={wallpaperId}
          doodles={doodles}
          onCancel={() => setWallpaperOpen(false)}
          onSave={(id, withDoodles) => {
            setWallpaperId(id);
            setDoodles(withDoodles);
            setWallpaperOpen(false);
          }}
        />
      )}
    </div>
  );
}

function Dialog({ title, children, onCancel, onOk }: { title: string; children: React.ReactNode; onCancel: () => void; onOk: () => void }) {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal aria-label={title}>
      <div className="w-full max-w-sm rounded-2xl bg-wa-card p-6 shadow-2xl">
        <h2 className="text-[20px] font-medium">{title}</h2>
        {children}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-full px-4 py-2 text-[15px] font-medium text-wa-accent hover:bg-wa-hover">
            Cancel
          </button>
          <button type="button" onClick={onOk} className="rounded-full bg-wa-green px-5 py-2 text-[15px] font-medium text-black hover:brightness-110">
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

function ThemeDialog({ value, onCancel, onSave }: { value: ThemeSetting; onCancel: () => void; onSave: (next: ThemeSetting) => void }) {
  const [choice, setChoice] = useState<ThemeSetting>(value);
  const options: ThemeSetting[] = ["light", "dark", "system"];
  return (
    <Dialog title="Theme" onCancel={onCancel} onOk={() => onSave(choice)}>
      <ul className="mt-5 space-y-1">
        {options.map((opt) => (
          <li key={opt}>
            <label className="flex cursor-pointer items-center gap-4 rounded-lg px-2 py-2.5 text-[16px] hover:bg-wa-hover">
              <input
                type="radio"
                name="theme"
                value={opt}
                checked={choice === opt}
                onChange={() => setChoice(opt)}
                className="h-5 w-5 accent-wa-green"
              />
              {themeLabels[opt]}
            </label>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

function WallpaperDialog({
  value,
  doodles,
  onCancel,
  onSave,
}: {
  value: string;
  doodles: boolean;
  onCancel: () => void;
  onSave: (id: string, doodles: boolean) => void;
}) {
  const [choice, setChoice] = useState(value);
  const [withDoodles, setWithDoodles] = useState(doodles);
  return (
    <Dialog title="Wallpaper" onCancel={onCancel} onOk={() => onSave(choice, withDoodles)}>
      <ul className="mt-5 grid grid-cols-3 gap-3">
        {wallpapers.map((w) => (
          <li key={w.id}>
            <button
              type="button"
              onClick={() => setChoice(w.id)}
              aria-pressed={choice === w.id}
              className={`flex w-full flex-col items-center gap-2 rounded-xl p-2 transition hover:bg-wa-hover ${choice === w.id ? "ring-2 ring-wa-green" : ""}`}
            >
              <span
                aria-hidden
                className={`h-16 w-full rounded-lg border border-wa-border ${withDoodles ? "wa-doodles" : ""}`}
                style={{ backgroundColor: w.light }}
              />
              <span className="text-sm">{w.label}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-5 flex items-center justify-between">
        <span className="text-[15px]">Show doodles</span>
        <Toggle checked={withDoodles} onChange={setWithDoodles} label="Show doodles" />
      </div>
    </Dialog>
  );
}
