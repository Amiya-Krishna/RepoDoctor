import { useEffect, useState } from "react";
import { api, getErrorMessage } from "../lib/api";
import { authHeaders } from "../lib/auth";
import AuditHistory from "../components/AuditHistory";

interface Notification { id: string; title: string; message: string; severity: string; createdAt: string; readAt: string | null }

export default function Activity({ onRead }: { onRead: () => void }) {
  const [tab, setTab] = useState<"notifications" | "audit">("notifications");
  const [notifications, setNotifications] = useState<Notification[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (tab !== "notifications") return;
    api.get<{ notifications: Notification[] }>("/privacy/notifications", { headers: authHeaders() })
      .then((r) => { setError(""); setNotifications(r.data.notifications); return api.post("/privacy/notifications/read", {}, { headers: authHeaders() }).then(onRead); })
      .catch((e: unknown) => setError(getErrorMessage(e, "Could not load activity.")));
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
      {tab === "audit" && <AuditHistory />}
    </section>
  );
}
