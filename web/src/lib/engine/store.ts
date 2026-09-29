// Server-side credential storage. Only server actions may expose filtered results.
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import type { EngineModel, ProviderID } from "./catalog.ts";
export type EngineConfig = {
  selected: { provider: ProviderID; model: string } | null;
  keys: Partial<Record<ProviderID, { key: string; models: EngineModel[] }>>;
};
export function engineRoot() { return process.env.ENGINE_DATA_DIR || path.join(process.cwd(), ".engine-data"); }
export async function userDirectory(userID: number) {
  if (!Number.isSafeInteger(userID) || userID < 1) throw new Error("Invalid account.");
  const dir = path.join(engineRoot(), String(userID));
  await mkdir(dir, { recursive: true, mode: 0o700 });
  return dir;
}
async function encryptionKey(dir: string) {
  const keyPath = path.join(dir, "storage.key");
  try { await writeFile(keyPath, randomBytes(32), { flag: "wx", mode: 0o600 }); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
  const key = await readFile(keyPath);
  if (key.length !== 32) throw new Error("Engine credential storage is unavailable.");
  return key;
}
export async function readConfig(userID: number): Promise<EngineConfig> {
  const dir = await userDirectory(userID);
  let encrypted: Buffer;
  try { encrypted = await readFile(path.join(dir, "settings.enc")); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return { selected: null, keys: {} }; throw e; }
  const decipher = createDecipheriv("aes-256-gcm", await encryptionKey(dir), encrypted.subarray(0, 12));
  decipher.setAAD(Buffer.from(`blew-engine:${userID}`));
  decipher.setAuthTag(encrypted.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(encrypted.subarray(28)), decipher.final()]).toString());
}
export async function writeConfig(userID: number, config: EngineConfig) {
  const dir = await userDirectory(userID);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", await encryptionKey(dir), iv);
  cipher.setAAD(Buffer.from(`blew-engine:${userID}`));
  const data = Buffer.concat([cipher.update(JSON.stringify(config)), cipher.final()]);
  const temp = path.join(dir, `settings-${randomBytes(8).toString("hex")}.tmp`);
  await writeFile(temp, Buffer.concat([iv, cipher.getAuthTag(), data]), { mode: 0o600 });
  await rename(temp, path.join(dir, "settings.enc"));
}
const globalStore = globalThis as typeof globalThis & { engineLocks?: Map<number, Promise<unknown>> };
const locks = globalStore.engineLocks ??= new Map();
export async function withEngineLock<T>(userID: number, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(userID) || Promise.resolve();
  const next = previous.catch(() => {}).then(fn);
  locks.set(userID, next);
  try { return await next; } finally { if (locks.get(userID) === next) locks.delete(userID); }
}
