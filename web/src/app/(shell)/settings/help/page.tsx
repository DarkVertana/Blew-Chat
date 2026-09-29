import { EmptyState } from "@/components/chat/empty-state";
import { TwoPane } from "@/components/chat/two-pane";
import { HelpSettings } from "@/components/settings/help-settings";

export const dynamic = "force-dynamic";

export default function HelpSettingsPage() {
  return <TwoPane left={<HelpSettings />} main={<EmptyState />} />;
}
