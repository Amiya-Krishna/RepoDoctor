import { useEffect, useState } from "react";
import { api, getErrorMessage } from "../lib/api";
import { authHeaders } from "../lib/auth";

interface Notification { id: string; title: string; message: string; severity: string; createdAt: string; readAt: string | null }
interface AuditEvent { id: string; eventType: string; outcome: string; createdAt: string; details: unknown }

export default function Activity({ onRead }: { onRead: () => void }) {
  const [tab, setTab] = useState<"notifications" | "audit">("notifications");
  const [notifications, setNotifications] = useState<Notification[] | null>(null);
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const request = tab === "notifications"
      ? api.get<{ notifications: Notification[] }>("/privacy/notifications", { headers: authHeaders() })
          .then((r) => { setError(""); setNotifications(r.data.notifications); return api.post("/privacy/notifications/read", {}, { headers: authHeaders() }).then(onRead); })
      : api.get<{ events: AuditEvent[] }>("/privacy/audit", { headers: authHeaders() }).then((r) => { setError(""); setEvents(r.data.events); });
    request.catch((e: unknown) => setError(getErrorMessage(e, "Could not load activity.")));
  }, [tab, onRead]);

  return (
    <section aria-labelledby="activity-title" className="panel">
      <h2 id="activity-title">Activity</h2>
      <div role="tablist">
        <button role="tab" aria-selected={tab === "notifications"} onClick={() => setTab("notifications")}>Notifications</button>
        <button role="tab" aria-selected={tab === "audit"} onClick={() => setTab("audit")}>Audit history</button>
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      {tab === "notifications" && (notifications === null ? <p role="status">Loading…</p> : notifications.length === 0
        ? <p>No notifications yet. You will be told here when scans finish, fixes are ready for approval, or something needs your attention.</p>
        : <ul className="plain">{notifications.map((n) => (
            <li key={n.id}><strong>{n.title}</strong>{!n.readAt && " •"}<br />{n.message}<br /><small>{new Date(n.createdAt).toLocaleString()}</small></li>))}</ul>)}
      {tab === "audit" && (events === null ? <p role="status">Loading…</p> : events.length === 0
        ? <p>No security-relevant events recorded for your account yet.</p>
        : <table><thead><tr><th>When</th><th>Event</th><th>Outcome</th></tr></thead><tbody>{events.map((e) => (
            <tr key={e.id}><td>{new Date(e.createdAt).toLocaleString()}</td><td>{e.eventType}</td><td>{e.outcome}</td></tr>))}</tbody></table>)}
    </section>
  );
}
