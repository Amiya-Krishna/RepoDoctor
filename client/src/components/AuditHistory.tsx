import { useCallback, useEffect, useState } from "react";
import { api, getErrorMessage } from "../lib/api";
import { authHeaders } from "../lib/auth";

interface AuditEvent { id: string; eventType: string; outcome: string; repositoryId: string | null; repairJobId: string | null; createdAt: string; details: Record<string, unknown> | null }

/** The signed-in user's own audit trail (metadata only), newest first, loaded page by page. */
export default function AuditHistory() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (after?: string | null) => {
    setLoading(true); setError("");
    try {
      const r = await api.get<{ events: AuditEvent[]; nextCursor: string | null }>("/privacy/audit", { headers: authHeaders(), params: { limit: 20, ...(after ? { cursor: after } : {}) } });
      setEvents((prev) => (after ? [...prev, ...r.data.events] : r.data.events));
      setCursor(r.data.nextCursor);
      setLoaded(true);
    } catch (e) {
      setError(getErrorMessage(e, "Could not load your audit history."));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.get<{ events: AuditEvent[]; nextCursor: string | null }>("/privacy/audit", { headers: authHeaders(), params: { limit: 20 } })
      .then((r) => { if (!cancelled) { setEvents(r.data.events); setCursor(r.data.nextCursor); setLoaded(true); } })
      .catch((e: unknown) => { if (!cancelled) setError(getErrorMessage(e, "Could not load your audit history.")); });
    return () => { cancelled = true; };
  }, []);

  return (
    <section aria-labelledby="audit-title" className="panel">
      <h3 id="audit-title">Audit history</h3>
      <p><small>Security-relevant actions on your account. No source code or secrets are recorded here.</small></p>
      {error && <div role="alert" className="error"><p>{error}</p><button type="button" onClick={() => void load(cursor)}>Try again</button></div>}
      {loaded && events.length === 0 && !error && <p role="status">No events yet.</p>}
      {events.length > 0 && (
        <table>
          <thead><tr><th scope="col">When</th><th scope="col">Event</th><th scope="col">Result</th></tr></thead>
          <tbody>{events.map((e) => (
            <tr key={e.id}><td>{new Date(e.createdAt).toLocaleString()}</td><td>{e.eventType.replace(/_/g, " ").toLowerCase()}</td><td>{e.outcome.toLowerCase()}</td></tr>
          ))}</tbody>
        </table>
      )}
      {cursor && <button type="button" className="secondary" disabled={loading} onClick={() => void load(cursor)}>{loading ? "Loading…" : "Load more"}</button>}
    </section>
  );
}
