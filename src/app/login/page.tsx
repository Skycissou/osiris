'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Lock, User, LoaderCircle } from 'lucide-react';
import { login } from '@/lib/api';

// ── Page /login V4 — STANDBY (Émancipation Lot C, 13/07) ──────────────────────
//  Décision Cissou : on GARDE une page de connexion (pour montrer l'orga / l'esprit
//  « accès restreint ») mais tant que la vraie session comptes/auth (Better Auth +
//  Postgres) n'est pas branchée, « Se connecter » ENTRE SANS identifiants et amène
//  droit au cockpit. ZÉRO lien vers l'ancien login V3.
//
//  L2 sécurité (POST /login réel) reste DORMANT derrière le flag : le jour où l'auth
//  arrive, build avec NEXT_PUBLIC_AUTH_BYPASS=0 → les champs redeviennent obligatoires
//  et le POST /login est réactivé, sans retoucher cette page.
const AUTH_BYPASS = process.env.NEXT_PUBLIC_AUTH_BYPASS !== '0';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Standby : accès direct au cockpit, aucune donnée requise.
    if (AUTH_BYPASS) {
      router.push('/cockpit');
      return;
    }
    if (!username.trim() || !password || loading) return;
    setLoading(true);
    setError(null);
    const res = await login(username.trim(), password);
    setLoading(false);
    if (res.ok) {
      router.push('/cockpit');
    } else {
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
              mode dev · accès direct (auth en standby)
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
          className="osiris-btn osiris-btn-primary w-full py-2.5 text-sm font-mono tracking-widest disabled:opacity-40 disabled:hover:transform-none flex items-center justify-center gap-2"
        >
          {loading ? <LoaderCircle className="w-4 h-4 animate-spin" /> : 'SE CONNECTER'}
        </button>

        {/* Retour accueil (racine V4) — jamais vers la V3. */}
        <a
          href="/"
          className="text-center text-[10px] font-mono tracking-widest text-[var(--accent-bright)] hover:text-[var(--accent)] transition-colors"
        >
          ← Accueil
        </a>
      </motion.form>
    </main>
  );
}
