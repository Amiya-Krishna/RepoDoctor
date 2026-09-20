import { FormEvent, useState } from "react";
import { api } from "./lib/api";

function App() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  const handleLogin = async (event: FormEvent) => {
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

      setMessage("Login successful");
    } catch (error: any) {
      setMessage(
        error.response?.data?.message ||
          "Login failed"
      );
    }
  };

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
          onChange={(e) =>
            setPassword(e.target.value)
          }
        />

        <button type="submit">
          Login
        </button>
      </form>

      <p>{message}</p>
    </main>
  );
}

export default App;