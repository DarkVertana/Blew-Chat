"use client";

import { useActionState, useState } from "react";
import type { AuthFormState } from "@/app/actions/auth";
import { FormFeedback } from "./form-feedback";
import { PasswordChecklist } from "./password-checklist";
import { MAX_PASSWORD_BYTES, MIN_PASSWORD_LENGTH } from "@/lib/password-rules";

type Props = {
  mode: "login" | "register";
  action: (state: AuthFormState, formData: FormData) => Promise<AuthFormState>;
};

// Shared field styling: pill inputs and the green primary button of the chat UI.
export const labelClass = "block text-[15px] text-wa-muted";
export const inputClass =
  "mt-1.5 h-11 w-full rounded-full bg-wa-input px-4 text-[15px] text-wa-text outline-none ring-1 ring-transparent transition placeholder:text-wa-muted focus:ring-wa-green";
export const buttonClass =
  "w-full rounded-full bg-wa-green px-4 py-2.5 text-[15px] font-medium text-black transition hover:brightness-110 disabled:opacity-60";

export function AuthForm({ mode, action }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  const [password, setPassword] = useState("");
  const registering = mode === "register";

  return (
    <form action={formAction} className="mt-6 space-y-4">
      <label className={labelClass}>
        Email
        <input name="email" type="email" required autoComplete="email" className={inputClass} />
      </label>
      <label className={labelClass}>
        Password
        <input
          name="password"
          type="password"
          required
          minLength={registering ? MIN_PASSWORD_LENGTH : undefined}
          maxLength={MAX_PASSWORD_BYTES}
          autoComplete={registering ? "new-password" : "current-password"}
          className={inputClass}
          onChange={registering ? (e) => setPassword(e.target.value) : undefined}
        />
        {registering && <PasswordChecklist password={password} />}
      </label>

      <FormFeedback state={state} />

      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Please wait…" : registering ? "Create account" : "Sign in"}
      </button>
    </form>
  );
}
