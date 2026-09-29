import { requireUser } from "@/lib/auth";
import { EmptyState } from "@/components/chat/empty-state";
import { TwoPane } from "@/components/chat/two-pane";
import { SettingsRoot } from "@/components/settings/settings-root";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireUser();
  return <TwoPane left={<SettingsRoot user={user} />} main={<EmptyState />} />;
}
