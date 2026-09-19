import { useEffect, useState } from "react";
import { api } from "./lib/api";

function App() {
  const [status, setStatus] = useState("Checking backend...");

  useEffect(() => {
    api
      .get("/health")
      .then((response) => {
        setStatus(response.data.message);
      })
      .catch(() => {
        setStatus("Backend connection failed");
      });
  }, []);

  return (
    <main>
      <h1>RepoDoctor AI</h1>
      <p>{status}</p>
    </main>
  );
}

export default App;