import { LogoutForm } from "@/components/logout-form";
import { PasswordForm } from "@/components/password-form";
import { revokeSession } from "@/app/actions/auth";
import { activityLabel } from "@/lib/activity";
import type { ActivityEntry, SessionInfo, User } from "@/lib/auth";
import { describeUserAgent } from "@/lib/user-agent";
import { PanelHeader, SectionLabel } from "./primitives";

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "UTC" }) + " UTC";
const row = "mx-2 flex items-center justify-between gap-4 rounded-2xl px-3 py-3 transition hover:bg-wa-hover";

export function AccountSettings({
  user,
  sessions,
  activity,
}: {
  user: User;
  sessions: SessionInfo[] | null;
  activity: ActivityEntry[] | null;
}) {
  return (
    <div className="wa-scroll flex h-full flex-col overflow-y-auto pb-8">
      <PanelHeader title="Account" backHref="/settings" />
      <p className="px-5 text-[15px] text-wa-muted">{user.email}</p>

      <SectionLabel>Password</SectionLabel>
      <div className="mx-2 max-w-sm rounded-2xl px-3">
        <p className="text-[15px] text-wa-muted">Changing it signs out every other device.</p>
        <PasswordForm />
      </div>

      <SectionLabel>Active sessions</SectionLabel>
      <ul>
        {sessions === null && <li className="px-5 py-3 text-[15px] text-wa-muted">Could not load sessions.</li>}
        {sessions?.map((s) => (
          <li key={s.id} className={row}>
            <div className="min-w-0">
              <p className="truncate text-[17px]" title={s.user_agent ?? undefined}>
                {describeUserAgent(s.user_agent).label}
                {s.current && (
                  <span className="ml-2 rounded-full bg-wa-green-deep px-2 py-0.5 text-xs text-wa-accent">this device</span>
                )}
              </p>
              <p className="mt-0.5 truncate text-[15px] text-wa-muted">
                {s.ip ?? "unknown ip"} · last seen {when(s.last_seen_at)}
              </p>
            </div>
            <form action={revokeSession}>
              <input type="hidden" name="id" value={s.id} />
              <button
                type="submit"
                className="rounded-full border border-wa-border px-4 py-1.5 text-[15px] transition hover:bg-wa-elevated"
              >
                Revoke
              </button>
            </form>
          </li>
        ))}
      </ul>
      <div className="px-5 pt-3">
        <LogoutForm everywhere />
      </div>

      <SectionLabel>Recent activity</SectionLabel>
      <ul>
        {activity === null && <li className="px-5 py-3 text-[15px] text-wa-muted">Could not load activity.</li>}
        {activity?.slice(0, 20).map((a, i) => {
          const failed = a.status >= 400;
          return (
            <li key={`${a.occurred_at}-${i}`} className={row}>
              <div className="min-w-0">
                <p className="truncate text-[17px]">{activityLabel(a.action)}</p>
                <p className="mt-0.5 truncate text-[15px] text-wa-muted" title={a.user_agent ?? undefined}>
                  {describeUserAgent(a.user_agent).label} · {a.ip ?? "unknown ip"} · {when(a.occurred_at)}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs ${failed ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" : "bg-wa-green-deep text-wa-accent"}`}
              >
                {failed ? "failed" : "ok"}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
