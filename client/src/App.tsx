import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import AuthForm from "./components/AuthForm";
import { AUTH_EXPIRED_EVENT, api, getErrorMessage } from "./lib/api";
import Repositories from "./pages/Repositories";
import PrivacySettings, { type DataMode } from "./pages/PrivacySettings";
import Activity from "./pages/Activity";
import { authHeaders } from "./lib/auth";

type View = "repos" | "privacy" | "activity";

type Session = "checking" | "anonymous" | "authenticated";

function App() {
  const [session, setSession] = useState<Session>(
    localStorage.getItem("token") ? "checking" : "anonymous",
  );
  const [userName, setUserName] = useState("");
  const [notice, setNotice] = useState("");
  const [message, setMessage] = useState("");
  const [view, setView] = useState<View>("repos");
  const [dataMode, setDataMode] = useState<DataMode | null>(null);
  const [unread, setUnread] = useState(0);

  const refreshStatus = useCallback(() => {
    api.get<{ settings: { dataMode: DataMode } }>("/privacy", { headers: authHeaders() })
      .then((r) => {
        setDataMode(r.data.settings.dataMode);
        // First run: send the user to the one-time privacy choice before anything else.
        if (r.data.settings.dataMode === "NONE") setView((v) => (v === "repos" ? "privacy" : v));
      })
      .catch(() => undefined);
    api.get<{ unread: number }>("/privacy/notifications", { headers: authHeaders() })
      .then((r) => setUnread(r.data.unread)).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (session === "authenticated") refreshStatus();
  }, [session, refreshStatus]);

  const endSession = useCallback((text: string) => {
    localStorage.removeItem("token");
    setUserName("");
    setMessage("");
    setNotice(text);
    setSession("anonymous");
  }, []);

  // Validate a stored token once on load so a stale/expired token shows the
  // login form instead of a broken "logged in" screen.
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return;
    let cancelled = false;
    api
      .get<{ user: { name: string } }>("/auth/me", { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => {
        if (cancelled) return;
        setUserName(response.data.user.name);
        setSession("authenticated");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // A 401 is handled by the interceptor event below. For other failures
        // (API down) keep the user signed in; requests will report the error.
        if (!(axios.isAxiosError(error) && error.response?.status === 401)) {
          setSession("authenticated");
        }
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onExpired = () => endSession("Your session has expired. Please log in again.");
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, [endSession]);

  const handleAuthenticated = (token: string, mode: "login" | "register") => {
    localStorage.setItem("token", token);
    setNotice("");
    setMessage(mode === "register" ? "Account created successfully." : "Logged in successfully.");
    setSession("authenticated");
    api
      .get<{ user: { name: string } }>("/auth/me", { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => setUserName(response.data.user.name))
      .catch(() => undefined);
  };

  const connectGitHub = async (access: "public" | "private") => {
    try {
      const token = localStorage.getItem("token");
      if (!token) {
        endSession("Please log in first.");
        return;
      }
      const response = await api.get("/github/connect", {
        params: { access },
        headers: { Authorization: `Bearer ${token}` },
      });
      window.location.href = response.data.authUrl;
    } catch (error) {
      setMessage(getErrorMessage(error, "Failed to connect GitHub."));
    }
  };

  if (session === "checking") {
    return (
      <main className="auth-page">
        <p role="status">Checking your session…</p>
      </main>
    );
  }

  if (session === "anonymous") {
    return <AuthForm onAuthenticated={handleAuthenticated} notice={notice} />;
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <h1>RepoDoctor AI</h1>
        <div className="app-header-actions">
          {userName && <span className="user-name">{userName}</span>}
          <button type="button" className="secondary" onClick={() => endSession("You have been logged out.")}>
            Log out
          </button>
        </div>
      </header>
      <nav className="nav" aria-label="Main">
        <button type="button" aria-current={view === "repos" ? "page" : undefined} onClick={() => setView("repos")}>Repositories</button>
        <button type="button" aria-current={view === "privacy" ? "page" : undefined} onClick={() => setView("privacy")}>Privacy</button>
        <button type="button" aria-current={view === "activity" ? "page" : undefined} onClick={() => setView("activity")}>
          Activity{unread > 0 ? ` (${unread})` : ""}
        </button>
      </nav>
      {dataMode === "NONE" && view !== "privacy" && (
        <p className="banner" role="status">
          AI analysis is off, so nothing is sent to any model. <button type="button" onClick={() => setView("privacy")}>Choose a privacy mode</button>
        </p>
      )}
      {message && <p className="notice" role="status">{message}</p>}
      {view === "repos" && (
        <>
          <div className="toolbar">
            <button type="button" onClick={() => void connectGitHub("public")}>Connect GitHub (public repositories)</button>{" "}
            <button type="button" className="secondary" onClick={() => void connectGitHub("private")} title="Grants GitHub's broader 'repo' permission">
              Also allow private repositories
            </button>
          </div>
          <Repositories />
        </>
      )}
      {view === "privacy" && <PrivacySettings onChanged={(m) => { setDataMode(m); if (m !== "NONE") setView("repos"); }} />}
      {view === "activity" && <Activity onRead={() => setUnread(0)} />}
    </main>
  );
}

export default App;
