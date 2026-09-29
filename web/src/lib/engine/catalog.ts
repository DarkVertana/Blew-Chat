export const providers = [
  { id: "codex", name: "Codex", mode: "subscription", description: "Sign in with ChatGPT to use your plan's Codex access." },
  { id: "claude-code", name: "Claude Code", mode: "subscription", description: "Connect your own Claude Pro or Max account through Claude Code. Provider usage limits and billing rules apply." },
  { id: "openai", name: "OpenAI", mode: "api", description: "OpenAI models with separate API billing." },
  { id: "anthropic", name: "Anthropic", mode: "api", description: "Claude models through the Anthropic API." },
  { id: "google", name: "Google Gemini", mode: "api", description: "Gemini models through Google AI Studio." },
  { id: "groq", name: "Groq", mode: "api", description: "Models hosted on Groq." },
  { id: "mistral", name: "Mistral AI", mode: "api", description: "Mistral's hosted models." },
  { id: "deepseek", name: "DeepSeek", mode: "api", description: "DeepSeek's hosted models." },
  { id: "xai", name: "xAI", mode: "api", description: "Grok models through the xAI API." },
  { id: "openrouter", name: "OpenRouter", mode: "api", description: "Access models from many additional providers with one API key." },
] as const;
export type ProviderID = typeof providers[number]["id"];
export type EngineModel = { id: string; name: string };
export type Connection = { connected: boolean; models: EngineModel[]; account?: string; error?: string };
export type EngineState = { connections: Partial<Record<ProviderID, Connection>>; selected: { provider: ProviderID; model: string } | null };
export type Login = { provider: "codex" | "claude-code"; url: string; code?: string };
export function providerByID(id: unknown) {
  const provider = providers.find(p => p.id === id);
  if (!provider) throw new Error("Choose a supported provider.");
  return provider;
}
