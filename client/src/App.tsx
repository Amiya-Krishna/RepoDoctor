import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import AuthForm from "./components/AuthForm";
import { AUTH_EXPIRED_EVENT, api, getErrorMessage } from "./lib/api";
import Repositories from "./pages/Repositories";

type Session = "checking" | "anonymous" | "authenticated";

function App() {
  const [session, setSession] = useState<Session>(
    localStorage.getItem("token") ? "checking" : "anonymous",
  );
  const [userName, setUserName] = useState("");
  const [notice, setNotice] = useState("");
  const [message, setMessage] = useState("");

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

  const connectGitHub = async () => {
    try {
      const token = localStorage.getItem("token");
      if (!token) {
        endSession("Please log in first.");
        return;
      }
      const response = await api.get("/github/connect", {
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
      <div className="toolbar">
        <button type="button" onClick={() => void connectGitHub()}>Connect GitHub</button>
      </div>
      {message && <p className="notice" role="status">{message}</p>}
      <Repositories />
    </main>
  );
}

export default App;
