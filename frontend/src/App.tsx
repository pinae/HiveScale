import { useEffect, useState } from "react";

import WaveMark from "./components/WaveMark";

type BackendState = "checking" | "online" | "offline";

const STATUS_LABEL: Record<BackendState, string> = {
  checking: "Checking the tide…",
  online: "Backend online",
  offline: "Backend unreachable",
};

export default function App() {
  const [backend, setBackend] = useState<BackendState>("checking");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/health/")
      .then((res) => {
        if (!cancelled) setBackend(res.ok ? "online" : "offline");
      })
      .catch(() => {
        if (!cancelled) setBackend("offline");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="sw-shell">
      <WaveMark size={96} />
      <h1 className="sw-title">Societal Wavelength</h1>
      <p className="sw-tagline">
        Guess where society stands. Every guess makes the wave smarter.
      </p>
      <p className="sw-status" role="status" data-state={backend}>
        <span className="sw-status-dot" aria-hidden="true" />
        {STATUS_LABEL[backend]}
      </p>
    </main>
  );
}
