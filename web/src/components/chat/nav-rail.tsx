"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CircleDashed, MessageSquareText, Phone, Settings, Users, type LucideIcon } from "lucide-react";

const items: { href: string; label: string; icon: LucideIcon; dot?: boolean }[] = [
  { href: "/", label: "Chats", icon: MessageSquareText },
  { href: "/calls", label: "Calls", icon: Phone },
  { href: "/status", label: "Status", icon: CircleDashed, dot: true },
  { href: "/communities", label: "Communities", icon: Users },
];

export function AiOrb({ size = 24 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="block rounded-full bg-[conic-gradient(from_200deg,#2563eb,#a855f7,#ec4899,#8b5cf6,#2563eb)] shadow-[inset_0_0_0_2px_rgba(255,255,255,0.15)]"
      style={{ width: size, height: size }}
    />
  );
}

const railButton = "relative flex h-11 w-11 items-center justify-center rounded-xl transition";
const active = "bg-wa-elevated text-wa-text";
const idle = "text-wa-muted hover:bg-wa-hover hover:text-wa-text";

export function NavRail({ userEmail, userName, imageVersion }: { userEmail: string; userName: string; imageVersion: string | null }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <nav className="hidden w-[72px] shrink-0 flex-col items-center border-r border-wa-border bg-wa-bg py-3 md:flex">
      <ul className="flex flex-col items-center gap-1">
        {items.map(({ href, label, icon: Icon, dot }) => (
          <li key={href}>
            <Link
              href={href}
              title={label}
              aria-label={label}
              aria-current={isActive(href) ? "page" : undefined}
              className={`${railButton} ${isActive(href) ? active : idle}`}
            >
              <Icon size={22} strokeWidth={1.75} />
              {dot && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-wa-green" />}
            </Link>
          </li>
        ))}
      </ul>

      <div className="my-3 h-px w-8 bg-wa-border" />

      <Link href="/ai" title="Ask AI" aria-label="Ask AI" className={`${railButton} ${isActive("/ai") ? "bg-wa-elevated" : "hover:bg-wa-hover"}`}>
        <AiOrb />
      </Link>

      <div className="mt-auto flex flex-col items-center gap-2">
        <Link
          href="/settings"
          title="Settings"
          aria-label="Settings"
          aria-current={isActive("/settings") ? "page" : undefined}
          className={`${railButton} ${isActive("/settings") ? active : idle}`}
        >
          <Settings size={22} strokeWidth={1.75} />
        </Link>
        <Link
          href="/settings/profile"
          title={userName || userEmail}
          aria-label="Profile"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-wa-green-deep text-sm font-semibold text-wa-accent"
        >
          {imageVersion ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/profile/image?v=${encodeURIComponent(imageVersion)}`} alt="Your profile" className="h-full w-full rounded-full object-cover" />
          ) : (userName || userEmail).charAt(0).toUpperCase()}
        </Link>
      </div>
    </nav>
  );
}
