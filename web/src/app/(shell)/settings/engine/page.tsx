import { EmptyState } from "@/components/chat/empty-state";
import { TwoPane } from "@/components/chat/two-pane";
import { EngineSettings } from "@/components/settings/engine-settings";
import { requireUser } from "@/lib/auth";
export const dynamic = "force-dynamic";
export default async function EngineSettingsPage() {
  await requireUser();
  return <TwoPane left={<EngineSettings />} main={<EmptyState />} />;
}
