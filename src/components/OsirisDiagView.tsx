'use client';
// ─────────────────────────────────────────────────────────────────────────────
//  OsirisDiagView.tsx — Rendu de l'onglet « App » de la capsule debug (invention
//  #15). Ex-V4.073 « DebugPanel » : on a gardé la table lisible (source, lastCount,
//  ok/ko, HTTP, âge, verdicts + clés .env) mais SANS bouton ni modale — c'est
//  désormais la DebugCapsule (composant canonique du brain) qui porte le bouton 🐞
//  et le rapport copiable. Ce composant est passé à la capsule via `renderAppDiag`.
//
//  Pur rendu : reçoit le JSON déjà fetché par la capsule (getAppDiag →
//  /cockpit/live-feed/diag). Aucune requête ici. Lecture seule.
// ─────────────────────────────────────────────────────────────────────────────

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
  telemetry?: { sources?: Record<string, SourceCounter>; totalCalls?: number };
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

function ageStr(at: number | undefined, now: number): string {
  if (!at) return '—';
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}min`;
  return `${Math.round(s / 3600)}h`;
}

export default function OsirisDiagView({ diag }: { diag: unknown }) {
  const d = (diag && typeof diag === 'object' ? diag : {}) as DiagPayload;
  const now = Date.now();
  const sources = d.telemetry?.sources || {};
  const rows = Object.entries(sources).sort((a, b) => (b[1].lastAt || 0) - (a[1].lastAt || 0));
  const envKeys = d.env?.keys || [];

  return (
    <div style={{ fontSize: 12 }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: '#94a3b8', marginBottom: 4 }}>
        Sources amont ({rows.length})
      </div>
      <div style={{ border: '1px solid #ffffff12', borderRadius: 8, overflow: 'hidden', marginBottom: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#ffffff08', color: '#94a3b8', fontSize: 10, textTransform: 'uppercase' }}>
              <th style={{ textAlign: 'left', padding: '3px 6px' }}>Source</th>
              <th style={{ textAlign: 'right', padding: '3px 6px' }}>Count</th>
              <th style={{ textAlign: 'right', padding: '3px 6px' }}>OK/KO</th>
              <th style={{ textAlign: 'right', padding: '3px 6px' }}>HTTP</th>
              <th style={{ textAlign: 'right', padding: '3px 6px' }}>Âge</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={5} style={{ padding: '10px 6px', textAlign: 'center', color: '#94a3b8' }}>Aucun appel encore enregistré.</td></tr>
            )}
            {rows.map(([name, c]) => {
              const v = verdictOf(c);
              const m = V_META[v];
              return (
                <tr key={name} style={{ borderTop: '1px solid #ffffff0d' }} title={c.lastNote || m.label}>
                  <td style={{ padding: '3px 6px' }}>
                    <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: 99, background: m.dot, boxShadow: `0 0 5px ${m.dot}`, marginRight: 6 }} />
                    {name}
                  </td>
                  <td style={{ padding: '3px 6px', textAlign: 'right', color: v === 'empty' ? '#ffb23e' : v === 'ok' ? '#7cffb2' : '#e2e8f0' }}>
                    {c.lastCount ?? '—'}
                  </td>
                  <td style={{ padding: '3px 6px', textAlign: 'right' }}>{c.ok}/{c.fail}</td>
                  <td style={{ padding: '3px 6px', textAlign: 'right', color: c.lastStatus && c.lastStatus >= 400 ? '#ff5a5a' : '#e2e8f0' }}>{c.lastStatus ?? '—'}</td>
                  <td style={{ padding: '3px 6px', textAlign: 'right', color: '#94a3b8' }}>{ageStr(c.lastAt, now)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12, fontSize: 10, color: '#94a3b8' }}>
        {(['ok', 'empty', 'fail', 'idle'] as Verdict[]).map((v) => (
          <span key={v} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: 99, background: V_META[v].dot }} />
            {V_META[v].label}
          </span>
        ))}
      </div>

      {d.env && (
        <>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: '#94a3b8', marginBottom: 4 }}>
            Clés .env serveur ({d.env.configured}/{d.env.total})
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 12, rowGap: 2 }}>
            {envKeys.map((k) => (
              <div key={k.env} style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={k.usage}>
                <span style={{ color: k.present ? '#7cffb2' : '#6b7280' }}>{k.present ? '●' : '○'}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{k.env}</span>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 4 }}>
            ○ = absente du .env serveur (une clé saisie dans l&apos;app peut quand même marcher, par requête).
          </div>
        </>
      )}
    </div>
  );
}
