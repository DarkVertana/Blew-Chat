import type { EngineModel, ProviderID } from "./catalog.ts";
const endpoints: Partial<Record<ProviderID, string>> = {
  openai: "https://api.openai.com/v1/models", anthropic: "https://api.anthropic.com/v1/models?limit=1000",
  google: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", groq: "https://api.groq.com/openai/v1/models",
  mistral: "https://api.mistral.ai/v1/models", deepseek: "https://api.deepseek.com/models", xai: "https://api.x.ai/v1/models",
  openrouter: "https://openrouter.ai/api/v1/models/user",
};
export async function listAPIModels(provider: ProviderID, key: string): Promise<EngineModel[]> {
  const endpoint = endpoints[provider];
  if (!endpoint) throw new Error("This provider uses subscription login.");
  if (typeof key !== "string" || !key.trim() || key.length > 4096 || /[\x00-\x20\x7f]/.test(key)) throw new Error("Enter a valid API key without spaces.");
  const headers: Record<string, string> = provider === "anthropic" ? { "x-api-key": key, "anthropic-version": "2023-06-01" } :
    provider === "google" ? { "x-goog-api-key": key } : { Authorization: `Bearer ${key}` };
  // Fixed provider endpoints and no redirects prevent credentials reaching another host.
  const response = await fetch(endpoint, { headers, redirect: "error", signal: AbortSignal.timeout(15000), cache: "no-store" });
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 401 || response.status === 403 || (response.status === 400 && (provider === "google" || provider === "xai"))) throw new Error("The provider rejected this key. Check its permissions and billing account.");
    if (response.status === 429) throw new Error("Provider rate limit reached. Try again later.");
    throw new Error(`Provider connection failed (${response.status}). Try again later.`);
  }
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const {done,value} = await reader.read(); if (done) break; size += value.length; if (size > 4 * 1024 * 1024) throw new Error("Provider model list is too large."); chunks.push(value); } }
  finally { await reader.cancel(); }
  const body = JSON.parse(Buffer.concat(chunks).toString());
  const entries = provider === "google" ? body.models : body.data;
  if (!Array.isArray(entries)) throw new Error("The provider returned an invalid model list.");
  const models: EngineModel[] = entries.filter(m => provider !== "google" || m.supportedGenerationMethods?.includes("generateContent")).map(m => ({
    id: String(m.id || m.name || "").replace(/^models\//, ""), name: String(m.displayName || m.display_name || m.id || m.name || ""),
  })).filter(m => m.id.length > 0 && m.id.length < 256 && m.name.length < 300);
  if (!models.length) throw new Error("No models are available to this API key.");
  return models.sort((a,b) => a.name.localeCompare(b.name));
}
