import type { AuthFormState } from "@/app/actions/auth";

export function FormFeedback({ state }: { state: AuthFormState }) {
  if (state.success) {
    return (
      <p role="status" className="text-[14px] text-wa-accent">
        {state.success}
      </p>
    );
  }
  if (!state.error) return null;
  return (
    <div role="alert" className="text-[14px] text-red-600 dark:text-red-400">
      <p>{state.error}</p>
      {state.problems && state.problems.length > 0 && (
        <ul className="mt-1 list-disc pl-5">
          {state.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
