import type { Metadata } from "next";
import { headers } from "next/headers";
import { APP_NAME } from "@/lib/app";
import { themeBootstrapScript } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: APP_NAME,
  description: "Chat, calls and more.",
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: "default" },
  icons: { apple: "/notification-icon-192.png" },
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // The CSP only allows scripts carrying the per-request nonce from src/proxy.ts.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body className="min-h-screen bg-wa-bg text-wa-text antialiased">
        {children}
      </body>
    </html>
  );
}
