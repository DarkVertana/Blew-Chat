import { EmptyState } from "./empty-state";
import { TwoPane } from "./two-pane";

/** Left-panel stub for sections that are not built yet. */
export function PlaceholderView({ title, blurb }: { title: string; blurb: string }) {
  return (
    <TwoPane
      left={
        <div className="px-5 pt-6">
          <h1 className="text-[22px] font-medium">{title}</h1>
          <p className="mt-6 text-[15px] text-wa-muted">{blurb}</p>
        </div>
      }
      main={<EmptyState />}
    />
  );
}
