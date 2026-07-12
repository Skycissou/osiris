"use client";
// 🐞 DebugCapsule v1.0 — capsule debug standard (invention #15 devenue composant)
// Source canonique : claude-brain → capsules/debug-capsule/ · Règle : améliorer ICI puis re-copier, jamais de fork.
// Zéro dépendance · styles inline · lecture seule · rien ne quitte l'appareil.

import { useEffect, useRef, useState, useCallback } from "react";
import type { CSSProperties, ReactNode } from "react";

type Kind = "error" | "warn" | "js" | "promise" | "http" | "network";
type Item = { t: number; kind: Kind; msg: string; detail?: string };

type Props = {
  appName: string;
  version?: string;
  enabled?: boolean;
  position?: "bottom-left" | "bottom-right";
  maxEvents?: number;
  /** Diag fourni par l'app (ex. OSIRIS : fetch /cockpit/live-feed/diag). Affiché en onglet App + inclus au rapport. */
  getAppDiag?: () => Promise<unknown>;
  /** Rendu custom de l'onglet App (ex. OSIRIS : table sources/verdicts/âge). Défaut = JSON brut. Le rapport copié reste le JSON (agent-friendly). */
  renderAppDiag?: (diag: unknown) => ReactNode;
};

const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);

function toStr(v: unknown, max = 400): string {
  try {
    if (typeof v === "string") return truncate(v, max);
    if (v instanceof Error) return truncate(`${v.name}: ${v.message}`, max);
    return truncate(JSON.stringify(v), max);
  } catch {
    return truncate(String(v), max);
  }
}

export default function DebugCapsule({
  appName,
  version = "dev",
  enabled = process.env.NODE_ENV !== "production",
  position = "bottom-left",
  maxEvents = 80,
  getAppDiag,
  renderAppDiag,
}: Props) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"events" | "app" | "infos">("events");
  const [tick, setTick] = useState(0); // re-render quand le buffer bouge
  const [copied, setCopied] = useState(false);
  const [appDiag, setAppDiag] = useState<unknown>(null);
  const buf = useRef<Item[]>([]);

  const push = useCallback(
    (kind: Kind, msg: string, detail?: string) => {
      const b = buf.current;
      b.push({ t: Date.now(), kind, msg: truncate(msg, 300), detail: detail ? truncate(detail, 600) : undefined });
      if (b.length > maxEvents) b.splice(0, b.length - maxEvents);
      setTick((x) => x + 1);
    },
    [maxEvents]
  );

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const w = window as typeof window & { __debugCapsule?: boolean };
    if (w.__debugCapsule) return; // anti double-montage
    w.__debugCapsule = true;

    const origError = console.error.bind(console);
    const origWarn = console.warn.bind(console);
    console.error = (...a: unknown[]) => {
      push("error", a.map((x) => toStr(x)).join(" "));
      origError(...a);
    };
    console.warn = (...a: unknown[]) => {
      push("warn", a.map((x) => toStr(x)).join(" "));
      origWarn(...a);
    };

    const onErr = (e: ErrorEvent) =>
      push("js", e.message || "Erreur JS", e.error instanceof Error ? e.error.stack ?? undefined : `${e.filename}:${e.lineno}`);
    const onRej = (e: PromiseRejectionEvent) => push("promise", "Promesse rejetée : " + toStr(e.reason), e.reason instanceof Error ? e.reason.stack ?? undefined : undefined);
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);

    const origFetch = window.fetch.bind(window);
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const url = typeof args[0] === "string" ? args[0] : args[0] instanceof URL ? args[0].href : (args[0] as Request).url;
      try {
        const res = await origFetch(...args);
        if (res.status >= 400) push("http", `HTTP ${res.status} → ${truncate(url, 140)}`);
        return res;
      } catch (err) {
        push("network", `Réseau KO → ${truncate(url, 140)}`, toStr(err));
        throw err;
      }
    };

    return () => {
      console.error = origError;
      console.warn = origWarn;
      window.removeEventListener("error", onErr);
      window.removeEventListener("unhandledrejection", onRej);
      window.fetch = origFetch;
      w.__debugCapsule = false;
    };
  }, [enabled, push]);

  const refreshDiag = useCallback(async () => {
    if (!getAppDiag) return;
    try {
      setAppDiag(await getAppDiag());
    } catch (e) {
      setAppDiag({ erreur: "getAppDiag KO", detail: toStr(e) });
    }
  }, [getAppDiag]);

  const buildReport = useCallback(() => {
    const items = buf.current;
    const lines: string[] = [
      `# 🐞 Rapport debug — ${appName} v${version}`,
      `- Date : ${new Date().toISOString()}`,
      `- URL : ${window.location.href}`,
      `- Navigateur : ${navigator.userAgent}`,
      `- Écran : ${window.innerWidth}×${window.innerHeight}`,
      ``,
      `## Événements capturés (${items.length})`,
    ];
    if (items.length === 0) lines.push("_Aucun événement._");
    items.forEach((it, i) => {
      lines.push(`${i + 1}. [${new Date(it.t).toLocaleTimeString("fr-FR")}] [${it.kind}] ${it.msg}`);
      if (it.detail) lines.push("   " + it.detail.replace(/\n/g, "\n   "));
    });
    if (appDiag != null) {
      lines.push(``, `## Diag applicatif`, "```json", toStr(appDiag, 6000), "```");
    }
    return lines.join("\n");
  }, [appName, version, appDiag]);

  const copyReport = useCallback(async () => {
    if (getAppDiag) await refreshDiag();
    const text = buildReport();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [buildReport, refreshDiag, getAppDiag]);

  if (!enabled) return null;

  const errCount = buf.current.filter((i) => i.kind !== "warn").length;
  const side: CSSProperties = position === "bottom-left" ? { left: 16 } : { right: 16 };
  const S: Record<string, CSSProperties> = {
    btn: { position: "fixed", bottom: 16, ...side, zIndex: 99998, width: 44, height: 44, borderRadius: 22, border: "1px solid #2dd4bf55", background: "#0b1220ee", color: "#e2e8f0", fontSize: 20, cursor: "pointer", boxShadow: "0 4px 14px #0008" },
    badge: { position: "absolute", top: -6, right: -6, minWidth: 18, height: 18, borderRadius: 9, background: "#ef4444", color: "#fff", fontSize: 11, lineHeight: "18px", padding: "0 4px", fontWeight: 700 },
    panel: { position: "fixed", bottom: 70, ...side, zIndex: 99999, width: "min(420px, calc(100vw - 24px))", maxHeight: "70vh", display: "flex", flexDirection: "column", background: "#0b1220f7", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 12, boxShadow: "0 10px 30px #000a", fontFamily: "ui-monospace, monospace", fontSize: 12 },
    head: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", borderBottom: "1px solid #334155" },
    tabs: { display: "flex", gap: 6, padding: "6px 10px", borderBottom: "1px solid #1e293b" },
    body: { overflowY: "auto", padding: 10, flex: 1, whiteSpace: "pre-wrap", wordBreak: "break-word" },
    foot: { display: "flex", gap: 8, padding: 10, borderTop: "1px solid #334155" },
    act: { flex: 1, padding: "8px 10px", borderRadius: 8, border: "1px solid #2dd4bf", background: "#134e4a", color: "#fff", cursor: "pointer", fontWeight: 700 },
    ghost: { padding: "8px 10px", borderRadius: 8, border: "1px solid #334155", background: "transparent", color: "#94a3b8", cursor: "pointer" },
  };
  const tabStyle = (on: boolean): CSSProperties => ({ padding: "3px 10px", borderRadius: 8, cursor: "pointer", border: "1px solid " + (on ? "#2dd4bf" : "#334155"), background: on ? "#134e4a" : "transparent", color: "#e2e8f0" });
  const KCOL: Record<Kind, string> = { error: "#ef4444", warn: "#f59e0b", js: "#ef4444", promise: "#f97316", http: "#38bdf8", network: "#ef4444" };

  return (
    <>
      <button aria-label="Debug" style={S.btn} onClick={() => { setOpen((o) => !o); if (!open && getAppDiag) void refreshDiag(); }}>
        🐞
        {errCount > 0 && <span style={S.badge}>{errCount > 99 ? "99+" : errCount}</span>}
      </button>
      {open && (
        <div style={S.panel}>
          <div style={S.head}>
            <strong>🐞 {appName} <span style={{ color: "#94a3b8" }}>v{version}</span></strong>
            <button style={S.ghost} onClick={() => setOpen(false)}>✖</button>
          </div>
          <div style={S.tabs}>
            <span style={tabStyle(tab === "events")} onClick={() => setTab("events")}>Événements ({buf.current.length})</span>
            {getAppDiag && <span style={tabStyle(tab === "app")} onClick={() => { setTab("app"); void refreshDiag(); }}>App</span>}
            <span style={tabStyle(tab === "infos")} onClick={() => setTab("infos")}>Infos</span>
          </div>
          <div style={S.body} data-tick={tick}>
            {tab === "events" && (buf.current.length === 0 ? "Aucun événement capturé. 👌" : [...buf.current].reverse().map((it, i) => (
              <div key={i} style={{ marginBottom: 8, borderLeft: `3px solid ${KCOL[it.kind]}`, paddingLeft: 6 }}>
                <span style={{ color: "#94a3b8" }}>{new Date(it.t).toLocaleTimeString("fr-FR")}</span>{" "}
                <span style={{ color: KCOL[it.kind], fontWeight: 700 }}>[{it.kind}]</span> {it.msg}
                {it.detail && <div style={{ color: "#94a3b8" }}>{it.detail}</div>}
              </div>
            )))}
            {tab === "app" && (appDiag == null ? "Chargement du diag…" : renderAppDiag ? renderAppDiag(appDiag) : toStr(appDiag, 6000))}
            {tab === "infos" && [`App : ${appName} v${version}`, `URL : ${typeof window !== "undefined" ? window.location.href : ""}`, `UA : ${typeof navigator !== "undefined" ? navigator.userAgent : ""}`, `Écran : ${typeof window !== "undefined" ? window.innerWidth + "×" + window.innerHeight : ""}`].join("\n")}
          </div>
          <div style={S.foot}>
            <button style={S.act} onClick={() => void copyReport()}>{copied ? "✅ Copié !" : "📋 Copier le rapport"}</button>
            <button style={S.ghost} onClick={() => { buf.current = []; setTick((x) => x + 1); }}>🗑</button>
          </div>
        </div>
      )}
    </>
  );
}
