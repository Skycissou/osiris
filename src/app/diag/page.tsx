'use client';

// ─────────────────────────────────────────────────────────────────────────────
//  /cockpit/diag — Page de lecture de la télémétrie (readonly, zéro lib)
//  Spec Claude 07/07 (§6). Accès par token (?token=…). Sélecteur de session +
//  timeline fusionnée (heure/canal/type/détail/statut) + filtre « erreurs only ».
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react';
import { BASE_PATH } from '@/lib/api';

interface SessionSummary {
  sid: string;
  first: number;
  last: number;
  count: number;
  errors: number;
}
interface Row {
  at: number;
  channel: 'ui' | 'fetch' | 'error' | 'amont';
  label: string;
  detail: Record<string, unknown>;
}

const hhmmss = (ms: number) => new Date(ms).toLocaleTimeString('fr-FR', { hour12: false });
const CHAN_COLOR: Record<Row['channel'], string> = {
  ui: '#9bdcf0',
  fetch: '#c9a2ff',
  amont: '#7cffb2',
  error: '#ff6b74',
};

export default function DiagPage() {
  const [token, setToken] = useState('');
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [sid, setSid] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [msg, setMsg] = useState('');

  // Récupère le token depuis l'URL (?token=) au chargement.
  useEffect(() => {
    try {
      const t = new URLSearchParams(location.search).get('token') || '';
      setToken(t);
    } catch {
      /* noop */
    }
  }, []);

  const loadSessions = useCallback(async (tok: string) => {
    setMsg('');
    try {
      const r = await fetch(`${BASE_PATH}/live-feed/diag/sessions?token=${encodeURIComponent(tok)}`, { cache: 'no-store' });
      if (r.status === 403) {
        setMsg('Token invalide ou absent (OSIRIS_DIAG_TOKEN).');
        setSessions(null);
        return;
      }
      const j = (await r.json()) as { sessions: SessionSummary[] };
      setSessions(j.sessions || []);
    } catch {
      setMsg('Chargement des sessions impossible.');
    }
  }, []);

  useEffect(() => {
    if (token) loadSessions(token);
  }, [token, loadSessions]);

  const loadSession = useCallback(
    async (s: string) => {
      setSid(s);
      setRows(null);
      try {
        const r = await fetch(`${BASE_PATH}/live-feed/diag/session?sid=${encodeURIComponent(s)}&token=${encodeURIComponent(token)}`, {
          cache: 'no-store',
        });
        const j = (await r.json()) as { rows: Row[] };
        setRows(j.rows || []);
      } catch {
        setMsg('Chargement de la session impossible.');
      }
    },
    [token],
  );

  const shown = (rows || []).filter((r) => !errorsOnly || r.channel === 'error' || (r.channel === 'amont' && r.detail.ok === false) || (r.channel === 'fetch' && r.detail.ok === false));

  return (
    <main style={{ minHeight: '100vh', background: '#070a0f', color: '#dbe4ee', fontFamily: 'IBM Plex Mono, monospace', padding: 20 }}>
      <h1 style={{ fontSize: 16, letterSpacing: '0.15em', color: '#54bdde' }}>OSIRIS — DIAG TÉLÉMÉTRIE</h1>

      {/* Token */}
      <div style={{ margin: '12px 0', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="token diag (OSIRIS_DIAG_TOKEN)"
          style={{ background: '#0d131b', border: '1px solid #24303f', color: '#fff', padding: '6px 10px', borderRadius: 6, fontSize: 12, minWidth: 260 }}
        />
        <button onClick={() => loadSessions(token)} style={btn}>Charger</button>
        {msg && <span style={{ color: '#ff6b74', fontSize: 12 }}>{msg}</span>}
      </div>

      {/* Sessions */}
      {sessions && (
        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 280 }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.2em', color: '#7f8da1', marginBottom: 6 }}>
              Sessions du jour ({sessions.length})
            </div>
            {sessions.length === 0 && <div style={{ fontSize: 12, color: '#7f8da1' }}>Aucune session enregistrée aujourd&apos;hui.</div>}
            {sessions.map((s) => (
              <button
                key={s.sid}
                onClick={() => loadSession(s.sid)}
                style={{
                  ...btn,
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  marginBottom: 4,
                  borderColor: sid === s.sid ? '#54bdde' : '#24303f',
                  color: s.errors > 0 ? '#ff6b74' : '#dbe4ee',
                }}
              >
                {s.sid.slice(0, 8)} · {s.count} evt · {s.errors} err · {hhmmss(s.first)}→{hhmmss(s.last)}
              </button>
            ))}
          </div>

          {/* Timeline */}
          <div style={{ flex: 1, minWidth: 340 }}>
            {rows && (
              <>
                <label style={{ fontSize: 11, display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
                  <input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} /> Erreurs seulement
                </label>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <tbody>
                    {shown.map((r, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,.05)' }}>
                        <td style={{ padding: '3px 8px', color: '#7f8da1', whiteSpace: 'nowrap' }}>{hhmmss(r.at)}</td>
                        <td style={{ padding: '3px 8px', color: CHAN_COLOR[r.channel], whiteSpace: 'nowrap' }}>[{r.channel}]</td>
                        <td style={{ padding: '3px 8px', color: '#fff', whiteSpace: 'nowrap' }}>{r.label}</td>
                        <td style={{ padding: '3px 8px', color: '#aeb9c7' }}>{fmtDetail(r.detail)}</td>
                      </tr>
                    ))}
                    {shown.length === 0 && (
                      <tr><td style={{ padding: 8, color: '#7f8da1' }}>Rien à afficher.</td></tr>
                    )}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

const btn: React.CSSProperties = {
  background: '#0d131b',
  border: '1px solid #24303f',
  color: '#dbe4ee',
  padding: '6px 10px',
  borderRadius: 6,
  fontSize: 12,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

function fmtDetail(d: Record<string, unknown>): string {
  return Object.entries(d)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${v}`)
    .join('  ');
}
