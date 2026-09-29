import { EmptyState } from "@/components/chat/empty-state";
import { TwoPane } from "@/components/chat/two-pane";
import { ChatsSettings } from "@/components/settings/chats-settings";

export const dynamic = "force-dynamic";

export default function ChatsSettingsPage() {
  return <TwoPane left={<ChatsSettings />} main={<EmptyState />} />;
}
