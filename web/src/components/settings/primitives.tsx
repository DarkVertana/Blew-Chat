import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, ChevronRight, type LucideIcon } from "lucide-react";

export function PanelHeader({ title, backHref }: { title: string; backHref?: string }) {
  return (
    <header className="flex h-[76px] shrink-0 items-center gap-3 px-5">
      {backHref && (
        <Link
          href={backHref}
          aria-label="Back"
          className="-ml-2 flex h-10 w-10 items-center justify-center rounded-full text-wa-text transition hover:bg-wa-hover"
        >
          <ArrowLeft size={22} />
        </Link>
      )}
      <h1 className="truncate text-[22px] font-medium tracking-tight">{title}</h1>
    </header>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <h2 className="px-5 pb-1 pt-8 text-[15px] text-wa-muted">{children}</h2>;
}

export function Chevron() {
  return <ChevronRight size={20} className="shrink-0 text-wa-muted" aria-hidden />;
}

type RowProps = {
  title: string;
  subtitle?: ReactNode;
  icon?: LucideIcon;
  href?: string;
  onClick?: () => void;
  trailing?: ReactNode;
  /** Red text and icon, for destructive rows like "Block" or "Delete chat". */
  danger?: boolean;
  className?: string;
};

/**
 * One settings row. A link when href is given, a button when onClick is, and a
 * plain block otherwise (for rows whose control lives in `trailing`, like a
 * toggle, so buttons are never nested). The wrapper carries the side inset so
 * the button variant, which does not stretch on its own, still spans the row.
 */
export function SettingsRow({ title, subtitle, icon: Icon, href, onClick, trailing, danger = false, className = "" }: RowProps) {
  const base = `flex w-full items-center gap-6 rounded-2xl px-3 py-4 text-left transition ${danger ? "text-red-600 dark:text-red-400" : ""} ${className}`;
  const body = (
    <>
      {Icon && <Icon size={24} strokeWidth={1.6} className={`shrink-0 ${danger ? "" : "text-wa-muted"}`} aria-hidden />}
      <div className="min-w-0 flex-1">
        <p className="text-[17px] leading-snug">{title}</p>
        {subtitle && <p className="mt-0.5 text-[15px] leading-snug text-wa-muted">{subtitle}</p>}
      </div>
      {trailing}
    </>
  );
  const row = href ? (
    <Link href={href} className={`${base} hover:bg-wa-hover`}>
      {body}
    </Link>
  ) : onClick ? (
    <button type="button" onClick={onClick} className={`${base} hover:bg-wa-hover`}>
      {body}
    </button>
  ) : (
    <div className={base}>{body}</div>
  );
  return <div className="px-2">{row}</div>;
}
