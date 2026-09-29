"use client";

import { useActionState, useState } from "react";
import { changePassword } from "@/app/actions/auth";
import { buttonClass, inputClass, labelClass } from "./auth-form";
import { FormFeedback } from "./form-feedback";
import { PasswordChecklist } from "./password-checklist";
import { MAX_PASSWORD_BYTES, MIN_PASSWORD_LENGTH } from "@/lib/password-rules";

export function PasswordForm() {
  const [state, formAction, pending] = useActionState(changePassword, {});
  const [next, setNext] = useState("");

  return (
    <form action={formAction} className="mt-4 space-y-4">
      <label className={labelClass}>
        Current password
        <input name="current_password" type="password" required autoComplete="current-password" className={inputClass} />
      </label>
      <label className={labelClass}>
        New password
        <input
          name="new_password"
          type="password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          maxLength={MAX_PASSWORD_BYTES}
          autoComplete="new-password"
          className={inputClass}
          onChange={(e) => setNext(e.target.value)}
        />
        <PasswordChecklist password={next} />
      </label>
      <label className={labelClass}>
        Confirm new password
        <input name="confirm_password" type="password" required autoComplete="new-password" className={inputClass} />
      </label>

      <FormFeedback state={state} />

      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Please wait…" : "Change password"}
      </button>
    </form>
  );
}
