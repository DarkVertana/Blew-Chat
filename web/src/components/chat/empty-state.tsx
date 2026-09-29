import Link from "next/link";
import { MessageSquarePlus, UserPlus, Video, type LucideIcon } from "lucide-react";
import { APP_NAME } from "@/lib/app";
import { AiOrb } from "./nav-rail";

const actions: { label: string; icon?: LucideIcon; ai?: boolean }[] = [
  { label: "New chat", icon: MessageSquarePlus },
  { label: "Add coworker", icon: UserPlus },
  { label: "New call", icon: Video },
  { label: "Ask AI", ai: true },
];

export function EmptyState({onNew}:{onNew?:()=>void}) {
  return (
    <div className="wa-scroll flex h-full flex-col items-center justify-center gap-12 overflow-y-auto px-6 py-10">
      <div className="w-full max-w-[460px] rounded-3xl bg-wa-card px-8 py-12 text-center shadow-sm">
        <Illustration className="mx-auto h-[130px] w-auto" />
        <h2 className="mt-10 text-[28px] leading-tight">Voice and video calling is now available</h2>
        <p className="mt-3 text-[17px] text-wa-muted">{onNew ? "Talk to your AI coworkers and share your screen in a chat." : `Now you can make and join calls on ${APP_NAME} Web.`}</p>
        {onNew ? <button onClick={onNew} className="mt-8 rounded-full bg-wa-green px-6 py-2.5 font-medium text-black">Create AI coworker</button> : <Link
          href="/calls"
          className="mt-8 inline-block rounded-full bg-wa-green px-6 py-2.5 text-[15px] font-medium text-black transition hover:brightness-110"
        >
          Go to Calls
        </Link>}
      </div>

      {<ul className="flex flex-wrap items-start justify-center gap-6 sm:gap-8">
        {actions.map(({ label, icon: Icon, ai }) => (
          <li key={label} className="flex w-24 flex-col items-center gap-3">
            <button
              type="button"
              title={label}
              onClick={onNew}
              className="flex h-20 w-20 items-center justify-center rounded-full bg-wa-elevated text-wa-text transition hover:bg-wa-hover"
            >
              {ai ? <AiOrb size={28} /> : Icon && <Icon size={26} strokeWidth={1.6} />}
            </button>
            <span className="text-center text-sm">{label}</span>
          </li>
        ))}
      </ul>}
    </div>
  );
}

/** Laptop with a phone and a handset, in the cream and green of the reference. */
function Illustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 220 150" className={className} aria-hidden>
      <rect x="44" y="18" width="150" height="100" rx="8" fill="#f4f1e8" stroke="#d9d3c3" strokeWidth="2" />
      <rect x="54" y="28" width="130" height="80" rx="4" fill="#fbfaf6" />
      <g transform="translate(150 42) scale(1.25)">
        <path
          d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"
          fill="none"
          stroke="#1f8f5f"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
      <rect x="26" y="118" width="186" height="12" rx="6" fill="#e6e1d3" />
      <rect x="96" y="118" width="46" height="4" rx="2" fill="#cfc8b6" />
      <rect x="30" y="34" width="52" height="98" rx="9" fill="#25d366" stroke="#159a4a" strokeWidth="2" />
      <rect x="37" y="44" width="38" height="70" rx="4" fill="#e3f7ea" />
      <rect x="43" y="52" width="26" height="4" rx="2" fill="#159a4a" opacity="0.5" />
      <rect x="43" y="61" width="20" height="4" rx="2" fill="#159a4a" opacity="0.4" />
      <rect x="43" y="70" width="24" height="4" rx="2" fill="#159a4a" opacity="0.3" />
      <circle cx="56" cy="122" r="3.5" fill="#0f5f2f" opacity="0.6" />
    </svg>
  );
}
