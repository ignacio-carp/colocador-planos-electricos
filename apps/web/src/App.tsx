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
          setHealth((data as any).status === "ok" ? "ok" : "unreachable");
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
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center px-6">
        <h1 className="text-2xl font-semibold mb-4">Cambre Planos de Luz</h1>
        <p className="text-gray-700">
          API health: <span className="font-mono">{health}</span>
        </p>
        <p className="text-sm text-gray-500 mt-2">GET /health (proxy en dev)</p>
      </div>
    </div>
  );
}

import React, { useEffect, useMemo } from 'react'
import Health from './pages/Health'

export default function App() {
  const path = useMemo(() => window.location.pathname, [])

  useEffect(() => {
    if (path === '/healthz') document.title = 'healthz'
  }, [path])

  if (path === '/healthz') {
    return <Health />
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-3xl font-semibold text-slate-900">VanguardIA</h1>
        <p className="mt-4 text-slate-700">
          MVP skeleton levantable. Healthcheck: <code className="rounded bg-slate-200 px-2 py-1">/healthz</code>
        </p>
      </div>
    </main>
  )
}

