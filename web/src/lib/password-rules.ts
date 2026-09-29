// Mirrors the server policy in api/internal/auth/password.go for live
// feedback. The API remains the source of truth and returns its own list of
// problems, which the forms display verbatim.
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_BYTES = 72;

export type PasswordCheck = { label: string; ok: boolean };

export function passwordChecks(password: string): PasswordCheck[] {
  const classes = [/\p{Ll}/u, /\p{Lu}/u, /\p{Nd}/u, /[^\p{Ll}\p{Lu}\p{Nd}]/u].filter((re) => re.test(password)).length;
  return [
    { label: `At least ${MIN_PASSWORD_LENGTH} characters`, ok: [...password].length >= MIN_PASSWORD_LENGTH },
    { label: "3 of 4: lowercase, uppercase, digits, symbols", ok: classes >= 3 },
    { label: `At most ${MAX_PASSWORD_BYTES} UTF-8 bytes`, ok: new TextEncoder().encode(password).length <= MAX_PASSWORD_BYTES },
  ];
}
