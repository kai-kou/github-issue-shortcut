import { useEffect, useState } from "react";
import "./App.css";

function App() {
  const [apiStatus, setApiStatus] = useState<string>("checking...");

  useEffect(() => {
    fetch("/api/health")
      .then((res) => {
        if (!res.ok) throw new Error(`unexpected status: ${res.status}`);
        return res.json() as Promise<{ status: string }>;
      })
      .then((data) => setApiStatus(data.status))
      .catch(() => setApiStatus("unreachable"));
  }, []);

  return (
    <>
      <h1>GitHub Issue Shortcut</h1>
      <p>Hello World</p>
      <p>API status: {apiStatus}</p>
    </>
  );
}

export default App;
