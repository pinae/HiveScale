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
    <main className="bsg-shell">
      <WaveMark size={96} />
      <h1 className="bsg-title">Baseline Guesser</h1>
      <p className="bsg-tagline">
        Guess where society stands. Every guess makes the wave smarter.
      </p>
      <p className="bsg-status" role="status" data-state={backend}>
        <span className="bsg-status-dot" aria-hidden="true" />
        {STATUS_LABEL[backend]}
      </p>
    </main>
  );
}
