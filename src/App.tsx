import { useEffect, useState } from "react";
import "./App.css";
import TermsOfService from "./pages/TermsOfService";
import PrivacyPolicy from "./pages/PrivacyPolicy";

function Home() {
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

function App() {
  const path = window.location.pathname;

  return (
    <>
      {path === "/terms" ? (
        <TermsOfService />
      ) : path === "/privacy" ? (
        <PrivacyPolicy />
      ) : (
        <Home />
      )}
      <footer>
        <a href="/terms">利用規約</a> / <a href="/privacy">プライバシーポリシー</a>
      </footer>
    </>
  );
}

export default App;
