export type NotificationPreferences = {
  messages: boolean;
  previews: boolean;
  sounds: boolean;
  groups: boolean;
  status: boolean;
};

export type NotificationState = {
  settings: NotificationPreferences;
  public_key: string;
  subscribed: boolean;
  user_id: number;
};

export function pushApplicationKey(value: string): Uint8Array<ArrayBuffer> {
  const raw = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

export function browserNotificationSupport(): boolean {
  return window.isSecureContext && "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;
}

export function browserStep<T>(promise: Promise<T>, message: string, timeout = 20_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeout);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}
