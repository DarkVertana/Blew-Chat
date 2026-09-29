import { Check, CheckCheck } from "lucide-react";
import type { MessageStatus } from "@/lib/mock-chats";

export function Ticks({ status, size = 16 }: { status?: MessageStatus; size?: number }) {
  if (status === "read") return <CheckCheck size={size} className="shrink-0 text-wa-tick" aria-label="Read" />;
  if (status === "delivered") return <CheckCheck size={size} className="shrink-0 text-wa-muted" aria-label="Delivered" />;
  return <Check size={size} className="shrink-0 text-wa-muted" aria-label="Sent" />;
}
