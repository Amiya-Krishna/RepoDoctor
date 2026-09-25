import { useState, type FormEvent } from "react";
import { api } from "./lib/api";
import Repositories from "./pages/Repositories";

function App() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loggedIn, setLoggedIn] = useState(
    !!localStorage.getItem("token")
  );

  const handleLogin = async (
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();

    try {
      const response = await api.post("/auth/login", {
        email,
        password,
      });

      localStorage.setItem(
        "token",
        response.data.data.token
      );

      setLoggedIn(true);
      setMessage("Login successful");
    } catch (error: any) {
      setMessage(
        error.response?.data?.message || "Login failed"
      );
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
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      window.location.href = response.data.authUrl;
    } catch (error) {
      console.error(error);
      setMessage("Failed to connect GitHub");
    }
  };

  if (loggedIn) {
    return (
      <main>
        <h1>RepoDoctor AI</h1>

        <button onClick={connectGitHub}>
          Connect GitHub
        </button>

        {message && <p>{message}</p>}

        <Repositories />
      </main>
    );
  }

  return (
    <main>
      <h1>RepoDoctor AI</h1>

      <form onSubmit={handleLogin}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <button type="submit">
          Login
        </button>
      </form>

      {message && <p>{message}</p>}
    </main>
  );
}

export default App;