"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { getNotificationState, saveNotificationPreferences, sendTestNotification, subscribeBrowser, unsubscribeBrowser } from "@/app/actions/notifications";
import { browserNotificationSupport, browserStep, pushApplicationKey, type NotificationPreferences, type NotificationState } from "@/lib/notifications";

function useNotificationController(initial: NotificationState) {
  const [settings, setSettings] = useState(initial.settings);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported" | "loading">("loading");
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const working = useRef(false);

  const refresh = useCallback(async () => {
    if (!browserNotificationSupport()) { setPermission("unsupported"); return; }
    setPermission(Notification.permission);
    const registration = await browserStep(navigator.serviceWorker.getRegistration("/"), "Browser notification setup is unavailable.");
    const subscription = registration ? await browserStep(registration.pushManager.getSubscription(), "Could not check the browser subscription.") : null;
    const result = await getNotificationState();
    if (result.error) throw new Error(result.error);
    if (working.current) return;
    setSettings(result.data!.settings);
    setEnabled(Notification.permission === "granted" && Boolean(subscription) && result.data!.subscribed);
  }, []);

  useEffect(() => {
    const sync = () => { void refresh().catch(() => setError("Could not refresh notification settings. Please try again.")); };
    let disposed = false;
    let permissionStatus: PermissionStatus | undefined;
    sync();
    window.addEventListener("focus", sync);
    // Also react when permission changes in the browser's site-info panel.
    if (navigator.permissions) {
      void navigator.permissions.query({ name: "notifications" }).then((status) => {
        if (disposed) return;
        permissionStatus = status;
        status.addEventListener("change", sync);
      }).catch(() => {}); // Not all browsers expose this permission descriptor.
    }
    return () => {
      disposed = true;
      window.removeEventListener("focus", sync);
      permissionStatus?.removeEventListener("change", sync);
    };
  }, [refresh]);

  async function perform(action: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(true); setError(""); setMessage("");
    try { await action(); }
    catch (err) { setMessage(""); setError(err instanceof Error ? err.message : "Could not update notifications. Please try again."); }
    finally { working.current = false; setBusy(false); }
  }

  function enable() {
    // Called directly by a click: Safari/Firefox require user activation.
    if (!browserNotificationSupport()) { setPermission("unsupported"); return; }
    void perform(async () => {
      setMessage("Choose Allow in your browser's notification prompt.");
      const granted = await browserStep(Notification.requestPermission(), "The browser did not complete the permission request. Open this app directly in Chrome, Edge, Firefox or Safari and try again.");
      setPermission(granted);
      if (granted !== "granted") {
        setEnabled(false);
        throw new Error(granted === "denied" ? "Notifications are blocked. Allow them in this site's browser settings, then try again." : "Notification permission was not granted. You can try again when ready.");
      }
      setMessage("Connecting browser notifications…");
      await browserStep(navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }), "Browser notification setup did not complete. Please try again.");
      const registration = await browserStep(navigator.serviceWorker.ready, "Browser notifications could not start. Please reload and try again.");
      let subscription = await browserStep(registration.pushManager.getSubscription(), "Could not check the browser subscription.");
      if (!subscription) subscription = await browserStep(registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: pushApplicationKey(initial.public_key) }), "The browser push service did not respond. Check your connection or try a supported browser.");
      const result = await subscribeBrowser(subscription.toJSON());
      if (result.error) throw new Error(result.error);
      setEnabled(true);
      setMessage("Notifications are enabled for this browser.");
    });
  }

  function disable() {
    void perform(async () => {
      // Remove the server destination first; a failed save must not claim off.
      const result = await unsubscribeBrowser();
      if (result.error) throw new Error(result.error);
      setEnabled(false);
      const registration = await navigator.serviceWorker.getRegistration("/");
      await (await registration?.pushManager.getSubscription())?.unsubscribe();
      for (const notice of await registration?.getNotifications() ?? []) notice.close();
      setMessage("Notifications are disabled for this browser.");
    });
  }

  function update(key: keyof NotificationPreferences, value: boolean) {
    void perform(async () => {
      const next = { ...settings, [key]: value };
      const result = await saveNotificationPreferences(next);
      if (result.error) throw new Error(result.error);
      setSettings(next); setMessage("Notification preferences saved.");
    });
  }

  function test() {
    void perform(async () => {
      const result = await sendTestNotification();
      if (result.error) throw new Error(result.error);
      setMessage("Test sent to this browser. Check your system notifications; Focus or Do Not Disturb may silence it.");
    });
  }
  return { settings, permission, enabled, busy, error, message, enable, disable, update, test };
}

const NotificationContext = createContext<ReturnType<typeof useNotificationController> | null>(null);

export function NotificationProvider({ initial, children }: { initial: NotificationState; children: ReactNode }) {
  const controller = useNotificationController(initial);
  return <NotificationContext.Provider value={controller}>{children}</NotificationContext.Provider>;
}

export function useNotifications() {
  const value = useContext(NotificationContext);
  if (!value) throw new Error("NotificationProvider is missing");
  return value;
}
