import { EmptyState } from "@/components/chat/empty-state";
import { TwoPane } from "@/components/chat/two-pane";
import { ProfileSettings } from "@/components/settings/profile-settings";
import { requireUser } from "@/lib/auth";
import { getProfile } from "@/lib/profile";

export const dynamic = "force-dynamic";

export default async function ProfileSettingsPage() {
  const user = await requireUser();
  const profile = await getProfile();
  return <TwoPane left={<ProfileSettings email={user.email} profile={profile} />} main={<EmptyState />} />;
}
