type Props = { initials: string; color: string; size?: number; className?: string };

export function Avatar({ initials, color, size = 48, className = "" }: Props) {
  return (
    <div
      aria-hidden
      className={`flex shrink-0 select-none items-center justify-center rounded-full font-medium text-white ${className}`}
      style={{ width: size, height: size, backgroundColor: color, fontSize: Math.round(size * 0.36) }}
    >
      {initials}
    </div>
  );
}
