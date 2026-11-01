import { useEffect, useState } from "react";
import { api, getErrorMessage } from "../lib/api";
import { authHeaders } from "../lib/auth";

export type DataMode = "NONE" | "CLOUD" | "LOCAL";

interface PrivacyResponse {
  settings: { dataMode: DataMode; consentedAt: string | null; retentionDays: number; notifyOnCritical: boolean };
  disclosure: {
    version: number;
    sent: string[];
    notSent: string[];
    destinations: { CLOUD: string; LOCAL: string };
    storedOnServer: string[];
    controls: string[];
  };
  availability: { cloud: boolean; local: boolean };
}

interface Props {
  onChanged: (mode: DataMode) => void;
}

export default function PrivacySettings({ onChanged }: Props) {
  const [data, setData] = useState<PrivacyResponse | null>(null);
  const [mode, setMode] = useState<DataMode>("NONE");
  const [consent, setConsent] = useState(false);
  const [retention, setRetention] = useState(30);
  const [notify, setNotify] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const load = () => {
    api.get<PrivacyResponse>("/privacy", { headers: authHeaders() })
      .then((r) => {
        setLoadError("");
        setData(r.data);
        setMode(r.data.settings.dataMode);
        setRetention(r.data.settings.retentionDays);
        setNotify(r.data.settings.notifyOnCritical);
      })
      .catch((e: unknown) => setLoadError(getErrorMessage(e, "Could not load privacy settings.")));
  };
  useEffect(load, []);

  if (loadError) {
    return <div role="alert"><p>{loadError}</p><button type="button" onClick={load}>Try again</button></div>;
  }
  if (!data) return <p role="status">Loading privacy settings…</p>;

  const needsConsent = mode !== "NONE" && !(data.settings.dataMode === mode && data.settings.consentedAt);
  const unavailable = (mode === "CLOUD" && !data.availability.cloud) || (mode === "LOCAL" && !data.availability.local);

  const save = async () => {
    setSaving(true);
    setStatus(null);
    try {
      const response = await api.put<{ settings: PrivacyResponse["settings"] }>("/privacy", {
        dataMode: mode, consent: mode !== "NONE" && (consent || !needsConsent), consentVersion: data.disclosure.version,
        retentionDays: retention, notifyOnCritical: notify,
      }, { headers: authHeaders() });
      setData({ ...data, settings: response.data.settings });
      setConsent(false);
      onChanged(response.data.settings.dataMode);
      setStatus({ kind: "ok", text: mode === "NONE" ? "AI processing is off. No code will be sent anywhere." : "Saved." });
    } catch (e) {
      setStatus({ kind: "error", text: getErrorMessage(e, "Could not save.") });
    } finally {
      setSaving(false);
    }
  };

  const deleteAll = async (deleteAccount: boolean) => {
    if (confirmText !== "DELETE") return;
    try {
      await api.delete("/privacy/data", { headers: authHeaders(), data: { confirm: "DELETE", deleteAccount } });
      if (deleteAccount) { localStorage.removeItem("token"); window.location.reload(); return; }
      setConfirmText("");
      setStatus({ kind: "ok", text: "All analysis data was deleted and the GitHub connection was removed." });
      load();
    } catch (e) {
      setStatus({ kind: "error", text: getErrorMessage(e, "Deletion failed. Nothing was reported as deleted.") });
    }
  };

  const d = data.disclosure;
  return (
    <section aria-labelledby="privacy-title" className="panel">
      <h2 id="privacy-title">Privacy and data processing</h2>
      <p>Choose once how RepoDoctor may use AI on your code. Until you choose, <strong>nothing is sent to any AI model</strong>.</p>

      <fieldset>
        <legend>Data-processing mode</legend>
        <label className="choice">
          <input type="radio" name="mode" checked={mode === "NONE"} onChange={() => setMode("NONE")} />
          <span><strong>Off</strong> — no AI analysis. Code stays on the server.</span>
        </label>
        <label className="choice">
          <input type="radio" name="mode" checked={mode === "LOCAL"} disabled={!data.availability.local} onChange={() => setMode("LOCAL")} />
          <span><strong>Self-hosted AI</strong> — {d.destinations.LOCAL}{!data.availability.local && " (not configured by your administrator)"}</span>
        </label>
        <label className="choice">
          <input type="radio" name="mode" checked={mode === "CLOUD"} disabled={!data.availability.cloud} onChange={() => setMode("CLOUD")} />
          <span><strong>Cloud AI</strong> — {d.destinations.CLOUD}{!data.availability.cloud && " (not configured by your administrator)"}</span>
        </label>
      </fieldset>

      <details open={mode !== "NONE"}>
        <summary>What is sent, where it goes, and how long it is kept</summary>
        <h3>Sent to the model</h3><ul>{d.sent.map((t) => <li key={t}>{t}</li>)}</ul>
        <h3>Never sent</h3><ul>{d.notSent.map((t) => <li key={t}>{t}</li>)}</ul>
        <h3>Stored on this server</h3><ul>{d.storedOnServer.map((t) => <li key={t}>{t}</li>)}</ul>
        <h3>Your controls</h3><ul>{d.controls.map((t) => <li key={t}>{t}</li>)}</ul>
      </details>

      {mode !== "NONE" && needsConsent && (
        <label className="choice">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>I have read the above and consent to my selected repository code being processed in this mode.</span>
        </label>
      )}

      <label>Keep analysis data for{" "}
        <input type="number" min={1} max={365} value={retention} onChange={(e) => setRetention(Number(e.target.value))} aria-label="Retention in days" /> days
      </label>
      <label className="choice">
        <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
        <span>Notify me about critical findings</span>
      </label>

      <button type="button" onClick={() => void save()} disabled={saving || unavailable || (mode !== "NONE" && needsConsent && !consent)}>
        {saving ? "Saving…" : "Save privacy settings"}
      </button>
      {status && <p role={status.kind === "error" ? "alert" : "status"} className={status.kind === "error" ? "error" : "notice"}>{status.text}</p>}

      <h3>Delete my data</h3>
      <p>Removes every analysis, patch, test output and repair record, your GitHub connection and your consent. This cannot be undone.</p>
      <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder='Type DELETE to confirm' aria-label="Type DELETE to confirm" />
      <button type="button" className="secondary" disabled={confirmText !== "DELETE"} onClick={() => void deleteAll(false)}>Delete analysis data</button>
      <button type="button" className="secondary" disabled={confirmText !== "DELETE"} onClick={() => void deleteAll(true)}>Delete data and my account</button>
    </section>
  );
}
