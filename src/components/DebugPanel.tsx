'use client';
// ─────────────────────────────────────────────────────────────────────────────
//  DebugPanel.tsx — Panneau de debug interne (invention #15 « standard debug
//  panel » du Brain, phase BUILD dev-pipeline). Standardisé sur le MVP Lucy
//  (11/07), branché ici sur OSIRIS à la demande de Cissou.
//
//  Rôle : rendre LISIBLE, DANS l'app, la télémétrie déjà collectée par le
//  endpoint /cockpit/live-feed/diag (jusqu'ici du JSON brut, illisible). On voit
//  d'un coup d'œil : quelle source répond, combien de données elle renvoie
//  (lastCount), l'âge du dernier appel, les clés env présentes, la santé du
//  collecteur d'avions, la version. Accès discret (bouton 🐞 en bas de page).
//
//  100 % lecture seule, aucune donnée sensible (les VALEURS de clés ne sont
//  jamais exposées par le endpoint — seulement présence + longueur).
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react';
import { BASE_PATH } from '@/lib/api';
import { OSIRIS_VERSION } from '@/lib/version';

interface SourceCounter {
  calls: number;
  ok: number;
  fail: number;
  lastStatus?: number;
  lastMs?: number;
  lastCount?: number;
  lastAt?: number;
  lastNote?: string;
}
interface DiagPayload {
  env?: { configured: number; total: number; keys: { env: string; usage: string; present: boolean; len: number }[] };
  serverStore?: { keys?: Record<string, { present?: boolean } | boolean> };
  telemetry?: { sources?: Record<string, SourceCounter>; totalCalls?: number };
  aircraftCollector?: Record<string, unknown>;
  ts?: number;
}

// Verdict par source : 🟢 répond ET renvoie des données · 🟠 répond mais 0 donnée
// (200-mais-vide, le cas géopolitique) · 🔴 échec · ⚪ jamais appelée.
type Verdict = 'ok' | 'empty' | 'fail' | 'idle';
function verdictOf(c: SourceCounter): Verdict {
  if (!c || c.calls === 0) return 'idle';
  const noteBad = /fail|abort|timeout|error|HTTP [45]/i.test(c.lastNote || '');
  if (c.ok === 0 || noteBad) return 'fail';
  if (c.lastStatus === 200 && c.lastCount === 0) return 'empty';
  return 'ok';
}
const V_META: Record<Verdict, { dot: string; label: string }> = {
  ok: { dot: '#7cffb2', label: 'OK (données)' },
  empty: { dot: '#ffb23e', label: '200 mais 0 donnée' },
  fail: { dot: '#ff5a5a', label: 'échec' },
  idle: { dot: '#6b7280', label: 'jamais appelée' },
};

function ageStr(at?: number, now?: number): string {
  if (!at || !now) return '—';
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}min`;
  return `${Math.round(s / 3600)}h`;
}

export default function DebugPanel() {
  const [open, setOpen] = useState(false);
  const [diag, setDiag] = useState<DiagPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [auto, setAuto] = useState(true);
  const [now, setNow] = useState<number>(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${BASE_PATH}/live-feed/diag`, { cache: 'no-store', credentials: 'include' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as DiagPayload;
      setDiag(j);
      setErr(null);
      setNow(Date.now());
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'erreur');
    } finally {
      setLoading(false);
    }
  }, []);

  // Charge à l'ouverture, puis auto-refresh 10 s tant que le panneau est ouvert.
  useEffect(() => {
    if (!open) return;
    void load();
    if (!auto) return;
    const id = setInterval(() => void load(), 10_000);
    return () => clearInterval(id);
  }, [open, auto, load]);

  const sources = diag?.telemetry?.sources || {};
  const rows = Object.entries(sources).sort((a, b) => (b[1].lastAt || 0) - (a[1].lastAt || 0));
  const envKeys = diag?.env?.keys || [];

  return (
    <>
      {/* Bouton discret — bas-droite, calque « Settings » de l'invention #15. */}
      <button
        onClick={() => setOpen((v) => !v)}
        title="Panneau de debug (diag live)"
        aria-label="Panneau de debug"
        className="fixed bottom-4 right-4 z-[300] w-9 h-9 grid place-items-center rounded-full text-[15px] pointer-events-auto opacity-60 hover:opacity-100 transition-opacity"
        style={{ background: 'rgba(10,14,22,0.72)', border: '1px solid rgba(124,255,178,0.25)', backdropFilter: 'blur(6px)' }}
      >
        🐞
      </button>

      {open && (
        <div className="fixed inset-0 z-[301] flex items-start justify-end pointer-events-none">
          <div
            className="pointer-events-auto m-3 flex flex-col rounded-[14px] overflow-hidden"
            style={{
              width: 'min(560px, 94vw)', maxHeight: '92vh',
              background: 'rgba(9,12,19,0.94)', border: '1px solid rgba(124,255,178,0.22)',
              backdropFilter: 'blur(10px)', boxShadow: '0 12px 40px rgba(0,0,0,0.55)', color: '#e6edf3',
            }}
          >
            {/* Header */}
            <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <span className="text-[13px] font-semibold">🐞 Debug — diag live</span>
              <span className="text-[11px] text-[var(--muted)]">{OSIRIS_VERSION}</span>
              <span className="text-[11px] text-[var(--muted)] ml-auto">{loading ? '…' : `màj ${ageStr(diag?.ts, now)}`}</span>
              <label className="text-[11px] flex items-center gap-1 cursor-pointer select-none">
                <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> auto
              </label>
              <button onClick={() => void load()} className="text-[12px] px-2 py-1 rounded hover:bg-white/10" title="Rafraîchir">↻</button>
              <button onClick={() => setOpen(false)} className="text-[13px] px-2 py-1 rounded hover:bg-white/10" title="Fermer">✕</button>
            </div>

            <div className="overflow-auto px-4 py-3 text-[12px]" style={{ lineHeight: 1.5 }}>
              {err && <div className="mb-3 px-3 py-2 rounded" style={{ background: 'rgba(255,90,90,0.12)', color: '#ff9a9a' }}>Diag injoignable : {err}</div>}

              {/* Sources amont */}
              <div className="text-[11px] uppercase tracking-wide text-[var(--muted)] mb-1">Sources amont ({rows.length})</div>
              <div className="rounded-[10px] overflow-hidden mb-4" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="text-[10px] uppercase text-[var(--muted)]" style={{ background: 'rgba(255,255,255,0.04)' }}>
                      <th className="text-left px-2 py-1">Source</th>
                      <th className="text-right px-2 py-1">Count</th>
                      <th className="text-right px-2 py-1">OK/KO</th>
                      <th className="text-right px-2 py-1">HTTP</th>
                      <th className="text-right px-2 py-1">Âge</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 && (
                      <tr><td colSpan={5} className="px-2 py-3 text-center text-[var(--muted)]">Aucun appel encore enregistré.</td></tr>
                    )}
                    {rows.map(([name, c]) => {
                      const v = verdictOf(c);
                      const m = V_META[v];
                      return (
                        <tr key={name} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }} title={c.lastNote || m.label}>
                          <td className="px-2 py-1">
                            <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: 99, background: m.dot, boxShadow: `0 0 5px ${m.dot}`, marginRight: 6 }} />
                            {name}
                          </td>
                          <td className="px-2 py-1 text-right" style={{ color: v === 'empty' ? '#ffb23e' : v === 'ok' ? '#7cffb2' : '#e6edf3' }}>
                            {c.lastCount ?? '—'}
                          </td>
                          <td className="px-2 py-1 text-right">{c.ok}/{c.fail}</td>
                          <td className="px-2 py-1 text-right" style={{ color: c.lastStatus && c.lastStatus >= 400 ? '#ff5a5a' : '#e6edf3' }}>{c.lastStatus ?? '—'}</td>
                          <td className="px-2 py-1 text-right text-[var(--muted)]">{ageStr(c.lastAt, now)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Légende */}
              <div className="flex flex-wrap gap-3 mb-4 text-[10px] text-[var(--muted)]">
                {(['ok', 'empty', 'fail', 'idle'] as Verdict[]).map((v) => (
                  <span key={v} className="flex items-center gap-1">
                    <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: 99, background: V_META[v].dot }} />
                    {V_META[v].label}
                  </span>
                ))}
              </div>

              {/* Clés env serveur */}
              {diag?.env && (
                <>
                  <div className="text-[11px] uppercase tracking-wide text-[var(--muted)] mb-1">
                    Clés .env serveur ({diag.env.configured}/{diag.env.total})
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 mb-2">
                    {envKeys.map((k) => (
                      <div key={k.env} className="flex items-center gap-1.5 truncate" title={k.usage}>
                        <span style={{ color: k.present ? '#7cffb2' : '#6b7280' }}>{k.present ? '●' : '○'}</span>
                        <span className="truncate">{k.env}</span>
                      </div>
                    ))}
                  </div>
                  <div className="text-[10px] text-[var(--muted)] mb-1">
                    ○ = absente du .env serveur (une clé saisie dans l’app peut quand même marcher, par requête).
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
