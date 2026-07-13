'use client';

// ─────────────────────────────────────────────────────────────────────────────
//  /cockpit/admin — Page OPÉRATEUR : coffre de clés « couches » côté serveur.
//
//  Retour Cissou 07/07 : un utilisateur ne peut pas faire du SSH. Ici l'opérateur
//  (toi) colle UNE fois les clés OpenSky/FIRMS/AIS → enregistrées côté serveur
//  (POST /admin/keys, protégé par token) → le collecteur et les couches les
//  utilisent pour TOUS les utilisateurs, durablement. Les users n'entrent RIEN.
//
//  La valeur n'est jamais relue depuis le serveur (on n'affiche que présence +
//  longueur) : pour changer une clé, on la re-saisit ; champ vide = suppression.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react';
import { BASE_PATH } from '@/lib/api';

interface KeyStatus {
  service: string;
  present: boolean;
  len: number;
}

const FIELDS: { service: string; label: string; hint: string; secret: boolean }[] = [
  { service: 'opensky_id', label: 'OpenSky — identifiant client', hint: 'client_id OAuth2 (ex. ton-email-api-client)', secret: false },
  { service: 'opensky_secret', label: 'OpenSky — secret client', hint: 'client_secret OAuth2 (chaîne longue)', secret: true },
  { service: 'firms', label: 'FIRMS — clé feux (NASA)', hint: 'MAP_KEY firms.modaps.eosdis.nasa.gov', secret: true },
  { service: 'ais_key', label: 'AIS — clé navires', hint: 'clé de ta source AIS (l’URL, elle, se pose côté serveur pour la sécurité)', secret: true },
];

const btn: React.CSSProperties = {
  background: '#0d131b', border: '1px solid #24303f', color: '#dbe4ee',
  padding: '6px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
};

export default function AdminPage() {
  const [token, setToken] = useState('');
  const [status, setStatus] = useState<KeyStatus[] | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    try {
      setToken(new URLSearchParams(location.search).get('token') || '');
    } catch {
      /* noop */
    }
  }, []);

  const loadStatus = useCallback(async (tok: string) => {
    setMsg('');
    try {
      const r = await fetch(`${BASE_PATH}/admin/keys`, { headers: { 'x-diag-token': tok }, cache: 'no-store' });
      if (r.status === 403) {
        setMsg('Token invalide ou absent (OSIRIS_DIAG_TOKEN).');
        setStatus(null);
        return;
      }
      const j = (await r.json()) as { keys: KeyStatus[] };
      setStatus(j.keys || []);
    } catch {
      setMsg('Chargement du statut impossible.');
    }
  }, []);

  useEffect(() => {
    if (token) loadStatus(token);
  }, [token, loadStatus]);

  const save = useCallback(async () => {
    setSaving(true);
    setMsg('');
    try {
      // On n'envoie QUE les champs réellement saisis (les vides ne touchent à rien,
      // sauf si l'opérateur veut effacer → on envoie '' explicitement via le bouton).
      const keys: Record<string, string> = {};
      for (const f of FIELDS) {
        const v = values[f.service];
        if (v !== undefined) keys[f.service] = v.trim();
      }
      const r = await fetch(`${BASE_PATH}/admin/keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-diag-token': token },
        body: JSON.stringify({ keys }),
      });
      if (r.status === 403) {
        setMsg('Refusé (token ou origine).');
        return;
      }
      const j = (await r.json()) as { ok?: boolean; keys?: KeyStatus[] };
      setStatus(j.keys || null);
      setValues({});
      setMsg('✅ Enregistré côté serveur. Les couches et le collecteur l’utilisent maintenant.');
    } catch {
      setMsg('Échec de l’enregistrement.');
    } finally {
      setSaving(false);
    }
  }, [values, token]);

  const statusOf = (service: string) => status?.find((s) => s.service === service);

  return (
    <main style={{ minHeight: '100vh', background: '#070a0f', color: '#dbe4ee', fontFamily: 'IBM Plex Mono, monospace', padding: 20 }}>
      <h1 style={{ fontSize: 16, letterSpacing: '0.15em', color: '#54bdde' }}>OSIRIS — ADMIN · CLÉS « COUCHES » (SERVEUR)</h1>
      <p style={{ fontSize: 11, color: '#7f8da1', maxWidth: 620, lineHeight: 1.5 }}>
        Réservé à l’opérateur. Les clés saisies ici sont enregistrées <b>côté serveur</b> (persistantes,
        sans SSH) et alimentent les couches partagées (avions vue monde OpenSky, feux FIRMS, navires AIS)
        pour <b>tous</b> les utilisateurs. Les utilisateurs n’ont rien à configurer.
      </p>

      <div style={{ margin: '12px 0', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="password" value={token} onChange={(e) => setToken(e.target.value)}
          placeholder="token admin (OSIRIS_DIAG_TOKEN)"
          style={{ background: '#0d131b', border: '1px solid #24303f', color: '#fff', padding: '6px 10px', borderRadius: 6, fontSize: 12, minWidth: 280 }}
        />
        <button onClick={() => loadStatus(token)} style={btn}>Charger le statut</button>
        {msg && <span style={{ color: msg.startsWith('✅') ? '#7cffb2' : '#ff6b74', fontSize: 12 }}>{msg}</span>}
      </div>

      {status && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 620 }}>
          {FIELDS.map((f) => {
            const st = statusOf(f.service);
            return (
              <div key={f.service} style={{ border: '1px solid #24303f', borderRadius: 8, padding: 12, background: 'rgba(255,255,255,.015)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>{f.label}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 10, color: st?.present ? '#7cffb2' : '#7f8da1' }}>
                    {st?.present ? `✅ enregistrée (${st.len})` : '— vide'}
                  </span>
                </div>
                <input
                  type={f.secret ? 'password' : 'text'}
                  value={values[f.service] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [f.service]: e.target.value }))}
                  placeholder={st?.present ? '•••••••••• (laisse vide = inchangé)' : 'Colle la clé ici…'}
                  spellCheck={false} autoComplete="off"
                  style={{ width: '100%', background: '#0d131b', border: '1px solid #24303f', color: '#fff', padding: '7px 10px', borderRadius: 6, fontSize: 12, fontFamily: 'inherit' }}
                />
                <div style={{ fontSize: 10, color: '#7f8da1', marginTop: 4 }}>{f.hint}</div>
              </div>
            );
          })}
          <div>
            <button onClick={save} disabled={saving} style={{ ...btn, borderColor: '#54bdde', color: '#54bdde', opacity: saving ? 0.5 : 1 }}>
              {saving ? '…' : 'Enregistrer côté serveur'}
            </button>
          </div>
          <p style={{ fontSize: 10, color: '#7f8da1', lineHeight: 1.5 }}>
            Laisse un champ vide pour ne pas y toucher. Pour <b>supprimer</b> une clé enregistrée, efface son
            contenu et ré-enregistre (un champ envoyé vide efface la clé côté serveur).
          </p>
        </div>
      )}
    </main>
  );
}
