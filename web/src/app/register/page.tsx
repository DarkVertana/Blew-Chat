import Link from "next/link";
import { redirect } from "next/navigation";
import { register } from "@/app/actions/auth";
import { AuthForm } from "@/components/auth-form";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  if (await getCurrentUser()) redirect("/");

  return (
    <main className="mx-auto min-h-dvh max-w-sm px-4 py-16 text-wa-text">
      <h1 className="text-2xl font-semibold tracking-tight">Create an account</h1>
      <p className="mt-1 text-[15px] text-wa-muted">
        Pick a long password you don&apos;t use anywhere else.
      </p>

      <AuthForm mode="register" action={register} />

      <p className="mt-6 text-[15px] text-wa-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-wa-accent hover:underline">
          Sign in
        </Link>
      </p>
    </main>
  );
}
