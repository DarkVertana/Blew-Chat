import Link from "next/link";
import { createNote } from "@/app/actions/notes";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { getSessionToken } from "@/lib/session";

export const dynamic = "force-dynamic";

type Note = { id: number; body: string; created_at: string };

export default async function NotesPage() {
  const user = await requireUser();
  const token = await getSessionToken();
  const notes = await api<Note[]>("/api/notes", { token }).catch(() => null);

  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <header>
        <Link href="/" className="text-sm text-zinc-500 underline-offset-4 hover:underline dark:text-zinc-400">
          ← Back to chats
        </Link>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">Your notes</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{user.email}</p>
      </header>

      <section className="mt-8">
        <form action={createNote} className="flex gap-2">
          <input
            name="body"
            required
            maxLength={1000}
            autoComplete="off"
            placeholder="Write a note…"
            className="flex-1 rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
          />
          <button
            type="submit"
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Add
          </button>
        </form>

        <ul className="mt-4 divide-y divide-zinc-200 dark:divide-zinc-800">
          {notes === null && <li className="py-3 text-sm text-zinc-500">Could not load notes from the API.</li>}
          {notes?.length === 0 && <li className="py-3 text-sm text-zinc-500">No notes yet. Add one above.</li>}
          {notes?.map((note) => (
            <li key={note.id} className="py-3">
              <p className="text-sm">{note.body}</p>
              <time dateTime={note.created_at} className="text-xs text-zinc-500 dark:text-zinc-400">
                {new Date(note.created_at).toLocaleString("en-US", { timeZone: "UTC" })} UTC
              </time>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
