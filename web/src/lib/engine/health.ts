export type EngineHealth = { status: "unconfigured" | "connected" | "expired" | "unavailable"; provider?: string };
// Claude manages refresh itself. Read only expiry metadata after the client has
// run; never send its credentials to any endpoint or return them to the browser.
export function claudeCredentialExpired(credentials: unknown, now = Date.now()): boolean {
  if (!credentials || typeof credentials !== "object") return false;
  const oauth = (credentials as {claudeAiOauth?:{expiresAt?:number;refreshTokenExpiresAt?:number;refreshToken?:string}}).claudeAiOauth;
  if (!oauth) return false;
  if (typeof oauth.refreshTokenExpiresAt === "number" && oauth.refreshTokenExpiresAt <= now) return true;
  // If the official status command did not renew an expired access token,
  // ask for reconnection while preserving both credentials for the client.
  return typeof oauth.expiresAt === "number" && oauth.expiresAt <= now;
}
export function engineBanner(health: EngineHealth | null) {
  if (!health || health.status === "connected") return null;
  if (health.status === "expired") return { title: `${health.provider || "AI engine"} sign-in expired or was revoked`, description: "Reconnect your account to keep using this engine.", action: "Reconnect" };
  if (health.status === "unavailable") return { title: "Could not verify your AI engine", description: "Your login is saved. Check the connection and try again.", action: "Check connection" };
  return {title:"Choose your AI engine",description:"Connect a provider and select a model to get started.",action:"Set up Engine"};
}
