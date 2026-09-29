import { EmptyState } from "@/components/chat/empty-state";
import { TwoPane } from "@/components/chat/two-pane";
import { PrivacySettings } from "@/components/settings/privacy-settings";

export const dynamic = "force-dynamic";

export default function PrivacySettingsPage() {
  return <TwoPane left={<PrivacySettings />} main={<EmptyState />} />;
}
