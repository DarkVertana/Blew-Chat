import type { ReactNode } from "react";

/**
 * The list/detail split to the right of the nav rail. On phones only one pane
 * shows at a time: the left one unless showMain is set.
 */
export function TwoPane({ left, main, showMain = false }: { left: ReactNode; main: ReactNode; showMain?: boolean }) {
  return (
    <>
      <aside
        className={`${showMain ? "hidden md:flex" : "flex"} w-full shrink-0 flex-col border-r border-wa-border bg-wa-panel md:w-[380px] lg:w-[440px] xl:w-[520px]`}
      >
        {left}
      </aside>
      <main className={`${showMain ? "flex" : "hidden md:flex"} min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-wa-main`}>{main}</main>
    </>
  );
}
