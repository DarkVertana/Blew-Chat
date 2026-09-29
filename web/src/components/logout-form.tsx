"use client";

import { useActionState } from "react";
import { logout, logoutAll } from "@/app/actions/auth";
import { FormFeedback } from "./form-feedback";

export function LogoutForm({ everywhere = false, buttonClassName }: { everywhere?: boolean; buttonClassName?: string }) {
  const [state, action, pending] = useActionState(everywhere ? logoutAll : logout, {});
  return (
    <form action={action} className="max-w-xs space-y-2">
      <button
        type="submit"
        disabled={pending}
        className={
          buttonClassName ??
          (everywhere
            ? "rounded-full border border-red-300 px-4 py-2 text-[15px] font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-60 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
            : "rounded-full border border-wa-border px-4 py-2 text-[15px] transition hover:bg-wa-hover disabled:opacity-60")
        }
      >
        {pending ? "Signing out…" : everywhere ? "Sign out everywhere" : "Sign out"}
      </button>
      <FormFeedback state={state} />
    </form>
  );
}
