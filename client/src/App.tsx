import { useState, type FormEvent } from "react";
import { api } from "./lib/api";
import Repositories from "./pages/Repositories";

function App() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [isRegister, setIsRegister] = useState(false);
  const [loggedIn, setLoggedIn] = useState(!!localStorage.getItem("token"));

  const handleAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage("");

    try {
      const endpoint = isRegister ? "/auth/register" : "/auth/login";
      const payload = isRegister ? { name, email, password } : { email, password };
      const response = await api.post(endpoint, payload);
      const token = response.data?.data?.token ?? response.data?.token;

      if (typeof token !== "string" || !token) {
        throw new Error("Authentication response did not contain a token");
      }

      localStorage.setItem("token", token);
      setLoggedIn(true);
      setMessage(isRegister ? "Account created successfully" : "Login successful");
    } catch (error: any) {
      setMessage(error.response?.data?.message ?? error.message ?? "Authentication failed");
    }
  };

  const connectGitHub = async () => {
    try {
      const token = localStorage.getItem("token");
      if (!token) {
        setMessage("Please login first");
        return;
      }

      const response = await api.get("/github/connect", {
        headers: { Authorization: `Bearer ${token}` },
      });
      window.location.href = response.data.authUrl;
    } catch (error) {
      console.error(error);
      setMessage("Failed to connect GitHub");
    }
  };

  const logout = () => {
    localStorage.removeItem("token");
    setLoggedIn(false);
    setMessage("Logged out");
  };

  if (loggedIn) {
    return (
      <main>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h1>RepoDoctor AI</h1>
          <button onClick={logout}>Logout</button>
        </header>
        <button onClick={() => void connectGitHub()}>Connect GitHub</button>
        {message && <p role="status">{message}</p>}
        <Repositories />
      </main>
    );
  }

  return (
    <main>
      <h1>RepoDoctor AI</h1>
      <h2>{isRegister ? "Create account" : "Login"}</h2>
      <form onSubmit={handleAuth}>
        {isRegister && (
          <input
            type="text"
            placeholder="Name"
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        )}
        <input
          type="email"
          placeholder="Email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Password"
          autoComplete={isRegister ? "new-password" : "current-password"}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          minLength={isRegister ? 8 : undefined}
          required
        />
        <button type="submit">{isRegister ? "Register" : "Login"}</button>
      </form>
      <button type="button" onClick={() => setIsRegister((value) => !value)}>
        {isRegister ? "Already have an account? Login" : "Need an account? Register"}
      </button>
      {message && <p role="alert">{message}</p>}
    </main>
  );
}

export default App;
