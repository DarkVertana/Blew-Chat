export const APP_NAME = "Blew Chats";

/** Fallback name when a user has not set their profile name: the email's local part. */
export function displayName(email: string): string {
  return email.split("@")[0] || email;
}
