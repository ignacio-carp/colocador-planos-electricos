import { useEffect, useState } from "react";

type HealthState = "loading" | "ok" | "unreachable";

export default function App() {
  const [health, setHealth] = useState<HealthState>("loading");

  useEffect(() => {
    let cancelled = false;

    fetch("/health")
      .then(async (r) => {
        const data: unknown = await r.json().catch(() => ({}));
        if (cancelled) return;

        if (r.ok && typeof data === "object" && data && "status" in data) {
          const status = (data as any).status;
          setHealth(status === "ok" ? "ok" : "unreachable");
        } else {
          setHealth("unreachable");
        }
      })
      .catch(() => {
        if (cancelled) return;
        setHealth("unreachable");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="text-center px-6">
        <h1 className="text-2xl font-semibold">Cambre Planos de Luz</h1>
        <p className="mt-4 text-slate-700">
          API health: <span className="font-mono">{health}</span>
        </p>
        <p className="mt-2 text-sm text-slate-500">GET /health</p>
      </div>
    </div>
  );
}

