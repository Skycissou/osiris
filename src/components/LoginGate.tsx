'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Lock, User, LoaderCircle } from 'lucide-react';
import { login } from '@/lib/api';

// 🔓 BYPASS AUTH (DEV) — demande Cissou 13/07 : « Se connecter » entre SANS pseudo/mdp
//  tant que la vraie session comptes/auth n'est pas faite. Désactiver au build :
//  NEXT_PUBLIC_AUTH_BYPASS=0.
const AUTH_BYPASS = process.env.NEXT_PUBLIC_AUTH_BYPASS !== '0';

/**
 * Écran de connexion — pose le cookie de session (POST /login) avant l'accès
 * au cockpit. Tant que l'utilisateur n'est pas authentifié, le backend
 * répond 401 sur /search. onAuthed() est appelé après un login réussi.
 */
export default function LoginGate({ onAuthed }: { onAuthed: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Mode dev : accès direct, aucune donnée requise (auth « en standby »).
    if (AUTH_BYPASS) { onAuthed(); return; }
    if (!username.trim() || !password || loading) return;
    setLoading(true);
    setError(null);
    const res = await login(username.trim(), password);
    setLoading(false);
    if (res.ok) {
      onAuthed();
    } else {
      // apiFetch lève sur 401 → on ne récupère pas le message JSON du backend.
      setError(res.error?.includes('401') ? 'Identifiants incorrects.' : (res.error || 'Échec de connexion.'));
    }
  };

  return (
    <main className="fixed inset-0 w-full h-full bg-[var(--bg)] flex items-center justify-center overflow-hidden">
      <motion.form
        onSubmit={submit}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="glass-panel w-[90%] max-w-sm p-8 flex flex-col gap-5"
      >
        <div className="flex flex-col items-center gap-1 mb-2">
          <h1 className="text-xl font-bold tracking-[0.4em] text-[var(--accent)] font-mono">OSIRIS</h1>
          <span className="text-[9px] font-mono tracking-[0.2em] opacity-70 uppercase text-[var(--accent)]">
            COCKPIT OSINT · V4 — Accès restreint
          </span>
          {AUTH_BYPASS && (
            <span className="mt-1 text-[9px] font-mono tracking-wide text-[var(--green,#5bc78d)] border border-[var(--green,#5bc78d)]/40 rounded px-2 py-0.5">
              mode dev · accès direct (auth désactivée)
            </span>
          )}
        </div>

        <label className="flex items-center gap-2 glass-panel px-3 py-2.5">
          <User className="w-4 h-4 text-[var(--faint)] shrink-0" />
          <input
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Identifiant"
            className="bg-transparent outline-none w-full text-sm font-mono text-[var(--ink)] placeholder:text-[var(--faint)]"
            autoFocus
          />
        </label>

        <label className="flex items-center gap-2 glass-panel px-3 py-2.5">
          <Lock className="w-4 h-4 text-[var(--faint)] shrink-0" />
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Mot de passe"
            className="bg-transparent outline-none w-full text-sm font-mono text-[var(--ink)] placeholder:text-[var(--faint)]"
          />
        </label>

        {error && (
          <div className="text-[11px] font-mono text-[var(--red,#db6f78)] border border-[var(--red,#db6f78)]/40 rounded px-3 py-2">
            ⚠ {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || (!AUTH_BYPASS && (!username.trim() || !password))}
          /* CTA principal = bouton primary dégradé accent + ombre glow (style .btn.primary de la landing) */
          className="osiris-btn osiris-btn-primary w-full py-2.5 text-sm font-mono tracking-widest disabled:opacity-40 disabled:hover:transform-none flex items-center justify-center gap-2"
        >
          {loading ? <LoaderCircle className="w-4 h-4 animate-spin" /> : 'SE CONNECTER'}
        </button>
      </motion.form>
    </main>
  );
}
