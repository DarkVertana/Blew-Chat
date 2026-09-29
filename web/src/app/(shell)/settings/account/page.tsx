import { EmptyState } from "@/components/chat/empty-state";
import { TwoPane } from "@/components/chat/two-pane";
import { AccountSettings } from "@/components/settings/account-settings";
import { api } from "@/lib/api";
import { requireUser, type ActivityEntry, type SessionInfo } from "@/lib/auth";
import { getSessionToken } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AccountSettingsPage() {
  const user = await requireUser();
  const token = await getSessionToken();
  const [sessions, activity] = await Promise.all([
    api<SessionInfo[]>("/api/auth/sessions", { token }).catch(() => null),
    api<ActivityEntry[]>("/api/auth/activity", { token }).catch(() => null),
  ]);
  return <TwoPane left={<AccountSettings user={user} sessions={sessions} activity={activity} />} main={<EmptyState />} />;
}
