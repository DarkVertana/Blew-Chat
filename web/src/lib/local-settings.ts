"use client";

import { useSyncExternalStore } from "react";

// Frontend-only preferences (toggles, theme, wallpaper) kept in localStorage.
// Store primitives only, so snapshots compare stably by value.

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function readSetting<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writeSetting<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or blocked storage: subscribers still re-read below.
  }
  listeners.forEach((listener) => listener());
}

export function useSetting<T>(key: string, fallback: T): [T, (value: T) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => readSetting(key, fallback),
    () => fallback, // server snapshot: hydrate with the default, then swap in the stored value
  );
  return [value, (next) => writeSetting(key, next)];
}
