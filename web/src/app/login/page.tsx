import Link from "next/link";
import { redirect } from "next/navigation";
import { login } from "@/app/actions/auth";
import { AuthForm } from "@/components/auth-form";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");

  return (
    <main className="mx-auto min-h-dvh max-w-sm px-4 py-16 text-wa-text">
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-1 text-[15px] text-wa-muted">Welcome back to Blew Chats.</p>

      <AuthForm mode="login" action={login} />

      <p className="mt-6 text-[15px] text-wa-muted">
        No account yet?{" "}
        <Link href="/register" className="font-medium text-wa-accent hover:underline">
          Create one
        </Link>
      </p>
    </main>
  );
}
