import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

function worker(state, status = 200) {
  const listeners = {};
  const shown = [];
  const opened = [];
  const self = {
    location: { origin: "https://blew.example" },
    addEventListener(name, fn) { listeners[name] = fn; },
    registration: { async showNotification(title, options) { shown.push({ title, ...options }); } },
    clients: { async matchAll() { return []; }, async openWindow(url) { opened.push(url); } },
  };
  vm.runInNewContext(readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"), {
    self, URL,
    async fetch(url, init) {
      assert.equal(url, "/api/notifications/state");
      assert.equal(init.credentials, "include");
      assert.equal(init.cache, "no-store");
      return { ok: status === 200, json: async () => state };
    },
  });
  return {
    shown, opened,
    async push(notice) {
      let done;
      listeners.push({ data: { json: () => notice }, waitUntil(promise) { done = promise; } });
      await done;
    },
    async click() {
      let done;
      listeners.notificationclick({ notification: { close() {}, data: { url: "https://attacker.example" } }, waitUntil(promise) { done = promise; } });
      await done;
    },
  };
}

const preferences = { messages: true, groups: true, status: true, previews: true, sounds: true };
const notice = { user_id: 1, kind: "message", title: "Sender", body: "Private message" };

test("worker displays permitted notification and honors preview/sound privacy", async () => {
  const visible = worker({ user_id: 1, subscribed: true, settings: preferences });
  await visible.push(notice);
  assert.equal(visible.shown[0].body, "Private message");
  assert.equal(visible.shown[0].silent, false);
  const hidden = worker({ user_id: 1, subscribed: true, settings: { ...preferences, previews: false, sounds: false } });
  await hidden.push(notice);
  assert.equal(hidden.shown[0].title, "Blew Chats");
  assert.equal(hidden.shown[0].body, "You have a new notification.");
  assert.equal(hidden.shown[0].silent, true);
});

test("queued notifications never display after logout, account switch or disabling", async () => {
  for (const [state, code] of [
    [{}, 401],
    [{ user_id: 2, subscribed: true, settings: preferences }, 200],
    [{ user_id: 1, subscribed: false, settings: preferences }, 200],
    [{ user_id: 1, subscribed: true, settings: { ...preferences, messages: false } }, 200],
  ]) {
    const w = worker(state, code);
    await w.push(notice);
    assert.equal(w.shown.length, 0);
  }
});

test("group/status preferences filter independently and clicks stay on this app", async () => {
  const w = worker({ user_id: 1, subscribed: true, settings: { ...preferences, groups: false, status: false } });
  for (const kind of ["group", "status", "unknown"]) await w.push({ ...notice, kind });
  assert.equal(w.shown.length, 0);
  await w.push({ ...notice, kind: "test" });
  assert.equal(w.shown.length, 1);
  await w.click();
  assert.deepEqual(w.opened, ["/"]);
});
