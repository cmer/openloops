import { Btn } from "./primitives";

export function LoadingBoard() {
  return (
    <div className="ol-state" role="status">
      <h2 style={{ color: "var(--ol-ink-3)" }}>Loading open loops…</h2>
      <div className="ol-skel" style={{ width: "100%" }} />
      <div className="ol-skel" style={{ width: "100%", height: "3rem" }} />
    </div>
  );
}

export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="ol-state is-error" role="alert">
      <h2>Couldn't reach OpenLoops.</h2>
      <p>
        <code>{message}</code>
      </p>
      <Btn variant="primary" onClick={onRetry}>
        Retry
      </Btn>
    </div>
  );
}

export function EmptyBoard({ assistantName }: { assistantName: string }) {
  return (
    <div className="ol-state">
      <h2>No open loops</h2>
      <p>When {assistantName} sends work, it lands in the lists below.</p>
    </div>
  );
}

export function EmptySection({ label, done, onShowAll }: { label: string; done: boolean; onShowAll: () => void }) {
  return (
    <div className="ol-state">
      <h2>Nothing in {label.toLowerCase()}</h2>
      <p>{done ? "Nothing was closed in the last 7 days." : "Pick another section, or go back to Everything."}</p>
      <Btn onClick={onShowAll}>Show everything</Btn>
    </div>
  );
}
