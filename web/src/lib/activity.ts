// Human labels for audit_log actions shown on the Account page.
const labels: Record<string, string> = {
  "login.success": "Signed in",
  "login.failed": "Failed sign-in attempt",
  "login.locked": "Sign-in blocked (too many attempts)",
  register: "Account created",
  "register.weak_password": "Registration rejected (weak password)",
  "register.conflict": "Registration rejected (email in use)",
  logout: "Signed out",
  "logout.all": "Signed out everywhere",
  "password.changed": "Password changed",
  "password.change_failed": "Password change failed (wrong password)",
  "password.change_rejected": "Password change rejected (weak password)",
  "session.revoked": "Session revoked",
  rate_limited: "Rate limited",
  "notes.list": "Viewed notes",
  "note.create": "Created a note",
  "GET /api/auth/me": "Session check",
  "GET /api/auth/sessions": "Viewed active sessions",
  "GET /api/auth/activity": "Viewed activity",
};

export function activityLabel(action: string): string {
  return labels[action] ?? action.replace(/^(GET|POST|PUT|PATCH|DELETE) \/api\//, "").replace(/\//g, " › ");
}
