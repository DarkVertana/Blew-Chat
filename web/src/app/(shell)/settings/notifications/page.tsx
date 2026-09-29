import { EmptyState } from "@/components/chat/empty-state";
import { TwoPane } from "@/components/chat/two-pane";
import { NotificationSettings } from "@/components/settings/notification-settings";

export const dynamic = "force-dynamic";

export default function NotificationSettingsPage() {
  return <TwoPane left={<NotificationSettings />} main={<EmptyState />} />;
}
