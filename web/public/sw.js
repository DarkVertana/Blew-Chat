/* No application pages, credentials or API responses are cached by this worker. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    if (!event.data) return;
    let notice;
    try { notice = event.data.json(); } catch { return; }
    // Verify current login and preferences at display time. A queued push
    // from a previous account must not leak after logout or account switching.
    const response = await fetch("/api/notifications/state", { credentials: "include", cache: "no-store", redirect: "error" }).catch(() => null);
    if (!response?.ok) return;
    const state = await response.json();
    if (state.user_id !== notice.user_id || !state.subscribed) return;
    const p = state.settings;
    const allowed = notice.kind === "test" || (notice.kind === "message" && p.messages) || (notice.kind === "group" && p.groups) || (notice.kind === "status" && p.status);
    if (!allowed) return;
    await self.registration.showNotification(p.previews ? String(notice.title || "Blew Chats") : "Blew Chats", {
      body: p.previews ? String(notice.body || "You have a new notification.") : "You have a new notification.",
      silent: !p.sounds,
      icon: "/notification-icon-192.png",
      tag: notice.kind === "test" ? "blew-test" : undefined,
      data: { url: "/" },
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.navigate("/");
        return client.focus();
      }
    }
    return self.clients.openWindow("/");
  })());
});
