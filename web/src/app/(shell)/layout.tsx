import { EngineProvider } from "@/components/engine-provider";
import { api } from "@/lib/api";
import { getSessionToken } from "@/lib/session";
import type { NotificationState } from "@/lib/notifications";
import { NotificationProvider } from "@/components/notification-provider";
import type { ReactNode } from "react";
import { NavRail } from "@/components/chat/nav-rail";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function ShellLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const notifications = await api<NotificationState>("/api/notifications", { token: await getSessionToken() });
  return (
    <NotificationProvider key={user.id} initial={notifications}>
    <EngineProvider>
    <div className="flex h-dvh overflow-hidden bg-wa-bg text-wa-text">
      <NavRail userEmail={user.email} userName={user.name} imageVersion={user.image_version} />
      {children}
    </div>
    </EngineProvider>
    </NotificationProvider>
  );
}
