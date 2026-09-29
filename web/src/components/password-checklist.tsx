"use client";

import { passwordChecks } from "@/lib/password-rules";

export function PasswordChecklist({ password }: { password: string }) {
  return (
    <div>
      <ul className="mt-2 space-y-1 text-[13px] text-wa-muted">
        {passwordChecks(password).map((check) => (
          <li key={check.label} className="flex items-center gap-2">
            <span
              aria-hidden
              className={`inline-block h-1.5 w-1.5 rounded-full ${check.ok ? "bg-wa-green" : "bg-wa-border"}`}
            />
            <span className={check.ok ? "text-wa-text" : undefined}>{check.label}</span>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-[13px] text-wa-muted">
        Common passwords and passwords containing your email are checked when you submit.
      </p>
    </div>
  );
}
