interface SpinnerProps {
  /** Accessible text announced to screen readers (not shown visually). */
  label?: string;
}

/** Small inline loading circle, shown while a worker waits for the AI/API response. */
export default function Spinner({ label = "Working…" }: SpinnerProps) {
  return <span className="spinner" role="status" aria-label={label} />;
}
