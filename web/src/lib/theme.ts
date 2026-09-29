export type ThemeSetting = "light" | "dark" | "system";

export const THEME_KEY = "blew:theme";

export const themeLabels: Record<ThemeSetting, string> = {
  light: "Light",
  dark: "Dark",
  system: "System default",
};

/** Sets data-theme on <html>; the stylesheet keys every colour off it. */
export function applyTheme(setting: ThemeSetting) {
  const resolved =
    setting === "system" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : setting;
  document.documentElement.dataset.theme = resolved;
}

// Runs inline in <head> before paint so the first frame already has the right
// theme. Re-reads storage on every evaluation so an in-app change wins over
// the value captured at load.
export const themeBootstrapScript = `(function(){try{var m=window.matchMedia("(prefers-color-scheme: dark)");function a(){var t="system";try{t=JSON.parse(localStorage.getItem(${JSON.stringify(THEME_KEY)})||'"system"')}catch(e){}document.documentElement.dataset.theme=t==="system"?(m.matches?"dark":"light"):t}a();m.addEventListener("change",a)}catch(e){}})();`;
