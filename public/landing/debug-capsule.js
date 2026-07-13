/* 🐞 debug-capsule.js — port VANILLA de la capsule debug (invention #15) pour la
 * landing STATIQUE d'OSIRIS V4 (public/landing/, servie à la racine `/`).
 *
 * Pourquoi un port : l'accueil est un fichier statique servi par rewrite → il n'est
 * PAS enveloppé par le layout React, donc le composant React `GlobalDebugCapsule`
 * ne l'atteint pas. Ce fichier reproduit le MÊME comportement en vanilla.
 * Source canonique du comportement : src/components/DebugCapsule.tsx (v1.3).
 *
 * ⚠️ GATE PAR DOMAINE (décision Cissou 13/07) : la capsule ne s'active QUE sur les
 * domaines de DEV listés ci-dessous → JAMAIS sur une future prod / le pitch national
 * (domaine absent de la liste = pas de bouton, aucun hook posé).
 */
(function () {
  'use strict';

  // ── GATE PAR DOMAINE ────────────────────────────────────────────────────────
  var DEV_HOSTS = ['osiris-v4.cissouhub.cloud', 'localhost', '127.0.0.1'];
  try {
    if (DEV_HOSTS.indexOf(window.location.hostname) === -1) return; // prod → rien
  } catch (e) { return; }
  if (window.__debugCapsule) return; // anti double-montage (co-existe avec la version React)
  window.__debugCapsule = true;

  var APP = 'OSIRIS V4 (accueil)';
  var MAX = 80;
  var buf = [];   // { t, kind, msg, detail, key, count }

  function truncate(s, n) { s = String(s); return s.length > n ? s.slice(0, n) + '…' : s; }
  function toStr(v, max) {
    max = max || 400;
    try {
      if (typeof v === 'string') return truncate(v, max);
      if (v instanceof Error) return truncate(v.name + ': ' + v.message, max);
      return truncate(JSON.stringify(v), max);
    } catch (e) { return truncate(String(v), max); }
  }

  function push(kind, msg, detail) {
    var m = truncate(msg, 300);
    var key = kind + '|' + m.slice(0, 100);   // dédup (URLs ne diffèrent qu'en fin)
    var ex = null;
    for (var i = 0; i < buf.length; i++) { if (buf[i].key === key) { ex = buf[i]; break; } }
    if (ex) { ex.count += 1; ex.t = Date.now(); if (detail) ex.detail = truncate(detail, 600); }
    else {
      buf.push({ t: Date.now(), kind: kind, msg: m, detail: detail ? truncate(detail, 600) : '', key: key, count: 1 });
      if (buf.length > MAX) buf.splice(0, buf.length - MAX);
    }
    render();
  }

  // ── CAPTURE (identique à la v1.3 React) ─────────────────────────────────────
  var origError = console.error.bind(console);
  var origWarn = console.warn.bind(console);
  console.error = function () { push('error', [].map.call(arguments, function (x) { return toStr(x); }).join(' ')); origError.apply(null, arguments); };
  console.warn = function () { push('warn', [].map.call(arguments, function (x) { return toStr(x); }).join(' ')); origWarn.apply(null, arguments); };

  window.addEventListener('error', function (e) {
    push('js', e.message || 'Erreur JS', e.error && e.error.stack ? e.error.stack : (e.filename + ':' + e.lineno));
  });
  window.addEventListener('unhandledrejection', function (e) {
    push('promise', 'Promesse rejetée : ' + toStr(e.reason), e.reason && e.reason.stack ? e.reason.stack : '');
  });

  var origFetch = window.fetch ? window.fetch.bind(window) : null;
  if (origFetch) {
    window.fetch = function () {
      var a = arguments;
      var first = a[0];
      var url = typeof first === 'string' ? first : (first && first.href) ? first.href : (first && first.url) ? first.url : String(first);
      return origFetch.apply(null, a).then(function (res) {
        if (res && res.status >= 400) push('http', 'HTTP ' + res.status + ' → ' + truncate(url, 140));
        return res;
      }, function (err) {
        // AbortError = annulation volontaire → PAS un bug (fidèle à la v1.2).
        var aborted = err && (err.name === 'AbortError' || /abort/i.test(err.message || ''));
        if (!aborted) push('network', 'Réseau KO → ' + truncate(url, 140), toStr(err));
        throw err;
      });
    };
  }

  // ── RAPPORT MARKDOWN (même format que le composant React) ───────────────────
  function buildReport() {
    var lines = [
      '# 🐞 Rapport debug — ' + APP,
      '- Date : ' + new Date().toISOString(),
      '- URL : ' + window.location.href,
      '- Navigateur : ' + navigator.userAgent,
      '- Écran : ' + window.innerWidth + '×' + window.innerHeight,
      '',
      '## Événements capturés (' + buf.length + ')'
    ];
    if (buf.length === 0) lines.push('_Aucun événement._');
    buf.forEach(function (it, i) {
      var mult = it.count > 1 ? ' (×' + it.count + ')' : '';
      lines.push((i + 1) + '. [' + new Date(it.t).toLocaleTimeString('fr-FR') + '] [' + it.kind + ']' + mult + ' ' + it.msg);
      if (it.detail) lines.push('   ' + it.detail.replace(/\n/g, '\n   '));
    });
    return lines.join('\n');
  }

  function copyReport(btn) {
    var text = buildReport();
    function ok() { btn.textContent = '✅ Copié !'; setTimeout(function () { btn.textContent = '📋 Copier le rapport'; }, 2000); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(ok, function () { fallback(); });
    } else { fallback(); }
    function fallback() {
      var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      ta.remove(); ok();
    }
  }

  // ── UI (mêmes couleurs / disposition que le composant) ──────────────────────
  var KCOL = { error: '#ef4444', warn: '#f59e0b', js: '#ef4444', promise: '#f97316', http: '#38bdf8', network: '#ef4444' };
  var open = false, tab = 'events', root;

  function el(tag, style, text) { var e = document.createElement(tag); if (style) e.style.cssText = style; if (text != null) e.textContent = text; return e; }

  function render() {
    if (!root) return;
    root.innerHTML = '';
    var side = 'left:16px;';
    var errCount = buf.reduce(function (s, i) { return s + (i.kind !== 'warn' ? i.count : 0); }, 0);

    var btn = el('button', 'position:fixed;bottom:16px;' + side + 'z-index:99998;width:44px;height:44px;border-radius:22px;border:1px solid #2dd4bf55;background:#0b1220ee;color:#e2e8f0;font-size:20px;cursor:pointer;box-shadow:0 4px 14px #0008;', '🐞');
    btn.setAttribute('aria-label', 'Debug');
    if (errCount > 0) {
      var badge = el('span', 'position:absolute;top:-6px;right:-6px;min-width:18px;height:18px;border-radius:9px;background:#ef4444;color:#fff;font-size:11px;line-height:18px;padding:0 4px;font-weight:700;', errCount > 99 ? '99+' : String(errCount));
      btn.style.position = 'fixed'; btn.appendChild(badge);
    }
    btn.onclick = function () { open = !open; render(); };
    root.appendChild(btn);
    if (!open) return;

    var panel = el('div', 'position:fixed;bottom:70px;' + side + 'z-index:99999;width:min(420px,calc(100vw - 24px));max-height:70vh;display:flex;flex-direction:column;background:#0b1220f7;color:#e2e8f0;border:1px solid #334155;border-radius:12px;box-shadow:0 10px 30px #000a;font-family:ui-monospace,monospace;font-size:12px;');

    var head = el('div', 'display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-bottom:1px solid #334155;');
    head.appendChild(el('strong', null, '🐞 ' + APP));
    var close = el('button', 'padding:8px 10px;border-radius:8px;border:1px solid #334155;background:transparent;color:#94a3b8;cursor:pointer;', '✖');
    close.onclick = function () { open = false; render(); };
    head.appendChild(close);
    panel.appendChild(head);

    var tabs = el('div', 'display:flex;gap:6px;padding:6px 10px;border-bottom:1px solid #1e293b;');
    [['events', 'Événements (' + buf.length + ')'], ['infos', 'Infos']].forEach(function (t) {
      var on = tab === t[0];
      var s = el('span', 'padding:3px 10px;border-radius:8px;cursor:pointer;border:1px solid ' + (on ? '#2dd4bf' : '#334155') + ';background:' + (on ? '#134e4a' : 'transparent') + ';color:#e2e8f0;', t[1]);
      s.onclick = function () { tab = t[0]; render(); };
      tabs.appendChild(s);
    });
    panel.appendChild(tabs);

    var body = el('div', 'overflow-y:auto;padding:10px;flex:1;white-space:pre-wrap;word-break:break-word;');
    if (tab === 'events') {
      if (buf.length === 0) body.textContent = 'Aucun événement capturé. 👌';
      else buf.slice().reverse().forEach(function (it) {
        var row = el('div', 'margin-bottom:8px;border-left:3px solid ' + KCOL[it.kind] + ';padding-left:6px;');
        row.appendChild(el('span', 'color:#94a3b8;', new Date(it.t).toLocaleTimeString('fr-FR')));
        row.appendChild(document.createTextNode(' '));
        row.appendChild(el('span', 'color:' + KCOL[it.kind] + ';font-weight:700;', '[' + it.kind + ']'));
        if (it.count > 1) row.appendChild(el('span', 'color:#ffb23e;font-weight:700;', ' ×' + it.count));
        row.appendChild(document.createTextNode(' ' + it.msg));
        if (it.detail) row.appendChild(el('div', 'color:#94a3b8;', it.detail));
        body.appendChild(row);
      });
    } else {
      body.textContent = ['App : ' + APP, 'URL : ' + window.location.href, 'UA : ' + navigator.userAgent, 'Écran : ' + window.innerWidth + '×' + window.innerHeight].join('\n');
    }
    panel.appendChild(body);

    var foot = el('div', 'display:flex;gap:8px;padding:10px;border-top:1px solid #334155;');
    var copy = el('button', 'flex:1;padding:8px 10px;border-radius:8px;border:1px solid #2dd4bf;background:#134e4a;color:#fff;cursor:pointer;font-weight:700;', '📋 Copier le rapport');
    copy.onclick = function () { copyReport(copy); };
    var clear = el('button', 'padding:8px 10px;border-radius:8px;border:1px solid #334155;background:transparent;color:#94a3b8;cursor:pointer;', '🗑');
    clear.onclick = function () { buf = []; render(); };
    foot.appendChild(copy); foot.appendChild(clear);
    panel.appendChild(foot);
    root.appendChild(panel);
  }

  function mount() {
    root = el('div');
    document.body.appendChild(root);
    render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
