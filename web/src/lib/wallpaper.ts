export type WallpaperId = "default" | "green" | "blue" | "pink" | "purple" | "gray";

export const WALLPAPER_KEY = "blew:wallpaper";
export const DOODLES_KEY = "blew:wallpaper-doodles";

/** Chat canvas colours per theme. The doodle pattern is drawn on top. */
export const wallpapers: { id: WallpaperId; label: string; light: string; dark: string }[] = [
  { id: "default", label: "Default", light: "#efeae2", dark: "#0b141a" },
  { id: "green", label: "Green", light: "#dcf1d9", dark: "#0f2a1f" },
  { id: "blue", label: "Blue", light: "#d8e9f3", dark: "#0f1f2b" },
  { id: "pink", label: "Pink", light: "#f4dee6", dark: "#2a1620" },
  { id: "purple", label: "Purple", light: "#e7dff3", dark: "#1f172b" },
  { id: "gray", label: "Gray", light: "#e6e6e6", dark: "#1e1e1e" },
];

export function wallpaperById(id: string) {
  return wallpapers.find((w) => w.id === id) ?? wallpapers[0];
}
