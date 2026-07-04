'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Lock, User, LoaderCircle } from 'lucide-react';
import { login } from '@/lib/api';

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
    <main className="fixed inset-0 w-full h-full bg-[var(--bg-void)] flex items-center justify-center overflow-hidden">
      <motion.form
        onSubmit={submit}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="glass-panel w-[90%] max-w-sm p-8 flex flex-col gap-5"
      >
        <div className="flex flex-col items-center gap-1 mb-2">
          <h1 className="text-xl font-bold tracking-[0.4em] text-[var(--gold-primary)] font-mono">OSIRIS</h1>
          <span className="text-[9px] font-mono tracking-[0.2em] opacity-70 uppercase text-[var(--gold-primary)]">
            COCKPIT OSINT · V4 — Accès restreint
          </span>
        </div>

        <label className="flex items-center gap-2 glass-panel px-3 py-2.5">
          <User className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
          <input
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Identifiant"
            className="bg-transparent outline-none w-full text-sm font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
            autoFocus
          />
        </label>

        <label className="flex items-center gap-2 glass-panel px-3 py-2.5">
          <Lock className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Mot de passe"
            className="bg-transparent outline-none w-full text-sm font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
          />
        </label>

        {error && (
          <div className="text-[11px] font-mono text-[var(--alert-red,#ff5c5c)] border border-[var(--alert-red,#ff5c5c)]/40 rounded px-3 py-2">
            ⚠ {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !username.trim() || !password}
          className="glass-panel py-2.5 text-sm font-mono tracking-widest text-[var(--gold-primary)] hover:border-[var(--gold-primary)]/50 transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
        >
          {loading ? <LoaderCircle className="w-4 h-4 animate-spin" /> : 'SE CONNECTER'}
        </button>
      </motion.form>
    </main>
  );
}
