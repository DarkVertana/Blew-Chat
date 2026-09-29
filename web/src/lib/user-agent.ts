// Turns a raw User-Agent string into a short device label such as
// "Chrome 129 on macOS" for the sessions and activity views. Deliberately
// small: it only needs to be recognisable to the account owner.

export type Device = { browser: string; os: string; label: string };

const OS_RULES: [RegExp, string][] = [
  [/iPhone/, "iPhone"],
  [/iPad/, "iPad"],
  [/Android/, "Android"],
  [/Windows/, "Windows"],
  [/CrOS/, "ChromeOS"],
  [/Mac OS X|Macintosh/, "macOS"],
  [/Linux/, "Linux"],
];

const BROWSER_RULES: [RegExp, string][] = [
  [/Edg(?:e|A|iOS)?\/(\d+)/, "Edge"],
  [/OPR\/(\d+)/, "Opera"],
  [/SamsungBrowser\/(\d+)/, "Samsung Internet"],
  [/(?:Firefox|FxiOS)\/(\d+)/, "Firefox"],
  [/(?:Chrome|CriOS)\/(\d+)/, "Chrome"],
  [/Version\/(\d+).*Safari\//, "Safari"],
  [/curl\/([\d.]+)/, "curl"],
];

export function describeUserAgent(ua: string | null | undefined): Device {
  if (!ua) return { browser: "Unknown client", os: "", label: "Unknown client" };

  const os = OS_RULES.find(([re]) => re.test(ua))?.[1] ?? "";

  let browser = "";
  for (const [re, name] of BROWSER_RULES) {
    const m = ua.match(re);
    if (m) {
      browser = m[1] ? `${name} ${m[1]}` : name;
      break;
    }
  }
  if (!browser) {
    // Something custom, e.g. "TestBrowser/1.0" or an API client: show its name.
    browser = ua.split(/[\s/(]/)[0] || "Unknown client";
  }

  return { browser, os, label: os ? `${browser} on ${os}` : browser };
}
