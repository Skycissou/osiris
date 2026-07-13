    const cards = {
      recherche_entreprises: {icon:'🏢', title:'Entreprises', tag:'officielle'},
      adresse: {icon:'📍', title:'Adresse / BAN', tag:'officielle'},
      geo_communes: {icon:'🗺', title:'API Geo', tag:'officielle'},
      data_gouv: {icon:'📚', title:'data.gouv', tag:'catalogue'},
      bodacc: {icon:'⚖', title:'BODACC', tag:'publique'},
      rna: {icon:'🤝', title:'Association (RNA)', tag:'publique'},
      dvf: {icon:'🏠', title:'DVF — foncier', tag:'publique'}
    };

    function escapeHtml(value){
      return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
    }
    function currentQuery(){return document.getElementById('q').value.trim() || '422606814'}

    const STATUS_FR = {
      found:     {label:'Trouvé',          cls:'open'},
      not_found: {label:'Aucun résultat',  cls:'key'},
      error:     {label:'Erreur',          cls:'lock'},
      blocked:   {label:'Réservé SIREN',   cls:'key'},
      partial:   {label:'Partiel',         cls:'key'}
    };
    function statusBadge(status){
      const s = STATUS_FR[status] || {label:status || 'statut', cls:'key'};
      return `<span class="tag ${s.cls}">${escapeHtml(s.label)}</span>`;
    }

    let LOAD_MSG_T = null, LOAD_TIMER_T = null, LOAD_START = 0;
    const LOAD_STEPS_SEARCH = ['Interrogation des sources publiques…', 'Analyse des entreprises…', 'Lecture BODACC, communes, datasets…', 'Mise en forme des résultats…'];
    const LOAD_STEPS_INV = ['Recherche initiale…', 'Exploration des dirigeants…', 'Pivot sur les adresses…', 'Rebonds en cascade (profondeur 2)…', 'Construction du graphe…'];

    function showLoading(title, deep){
      const el = document.getElementById('loading');
      if(!el) return;
      document.getElementById('results').style.display = 'none';
      document.getElementById('graph-wrap').style.display = 'none';
      el.style.display = '';
      document.getElementById('load-title').textContent = title || 'Recherche';
      const steps = deep ? LOAD_STEPS_INV : LOAD_STEPS_SEARCH;
      const stepEl = document.getElementById('load-step');
      let i = 0; stepEl.textContent = steps[0];
      clearInterval(LOAD_MSG_T); clearInterval(LOAD_TIMER_T);
      LOAD_MSG_T = setInterval(() => { i = (i + 1) % steps.length; stepEl.textContent = steps[i]; }, 1600);
      LOAD_START = Date.now();
      const tEl = document.getElementById('load-timer'); tEl.textContent = '0s';
      LOAD_TIMER_T = setInterval(() => { tEl.textContent = Math.round((Date.now() - LOAD_START) / 1000) + 's'; }, 300);
    }
    function hideLoading(){
      clearInterval(LOAD_MSG_T); clearInterval(LOAD_TIMER_T); LOAD_MSG_T = LOAD_TIMER_T = null;
      const el = document.getElementById('loading'); if(el) el.style.display = 'none';
      document.getElementById('results').style.display = VIEW === 'graph' ? 'none' : '';
      document.getElementById('graph-wrap').style.display = VIEW === 'graph' ? '' : 'none';
    }
    function renderLoading(title){ showLoading(title, DEEP); }

    function renderError(error){
      hideLoading();
      setView('list');
      document.getElementById('results').innerHTML = `<article class="result"><div class="top"><span class="icon">⚠️</span><span class="tag lock">erreur</span></div><h3>API indisponible</h3><p>${escapeHtml(error.message || error)}</p><div class="code">Lancer : uvicorn open_radar.app:app --reload --port 8797</div></article>`;
    }

    function sourceTitle(card){
      const meta = cards[card.source_id];
      return meta ? meta.title : (card.source_label || card.source_id || 'Source');
    }
    function sourceIcon(card){
      const meta = cards[card.source_id];
      return meta ? meta.icon : '•';
    }

    function sirenOf(card){
      const e = (card.entities || []).find(x => x.type === 'siren' && x.value);
      return e ? String(e.value).replace(/\s/g, '') : '';
    }
    function friendlyLink(card){
      const siren = sirenOf(card);
      if (siren && (card.source_id === 'recherche_entreprises' || card.source_id === 'bodacc')) {
        return {url:`https://annuaire-entreprises.data.gouv.fr/entreprise/${encodeURIComponent(siren)}`, label:'🔗 Fiche officielle (annuaire entreprises)'};
      }
      if (card.source_id === 'data_gouv' && card.raw_preview && card.raw_preview.id) {
        return {url:`https://www.data.gouv.fr/fr/datasets/${encodeURIComponent(card.raw_preview.id)}/`, label:'🔗 Voir le jeu de données'};
      }
      return null;
    }

    const GS = q => 'https://www.google.com/search?q=' + encodeURIComponent(q);
    function personDorks(name){
      return [
        {label:`"${name}"`, url:GS(`"${name}"`)},
        {label:`"${name}" + dirigeant / gérant / président`, url:GS(`"${name}" (dirigeant OR gérant OR président OR associé)`)},
        {label:`"${name}" sur LinkedIn`, url:GS(`"${name}" site:linkedin.com`)},
        {label:`"${name}" en PDF`, url:GS(`"${name}" filetype:pdf`)}
      ];
    }
    function companyDorks(name, siren){
      const a = [
        {label:`"${name}"`, url:GS(`"${name}"`)},
        {label:`"${name}" + bilan / statuts / PV`, url:GS(`"${name}" (bilan OR statuts OR "procès-verbal")`)},
        {label:`"${name}" en PDF`, url:GS(`"${name}" filetype:pdf`)},
        {label:`Sur Pappers`, url:'https://www.pappers.fr/recherche?q=' + encodeURIComponent(siren || name)},
        {label:`Sur societe.com`, url:'https://www.societe.com/cgi-bin/search?champs=' + encodeURIComponent(name)}
      ];
      if(siren) a.push({label:`Annuaire entreprises`, url:'https://annuaire-entreprises.data.gouv.fr/entreprise/' + encodeURIComponent(siren)});
      return a;
    }
    function addressDorks(addr){
      return [
        {label:`"${addr}"`, url:GS(`"${addr}"`)},
        {label:`Entreprises à cette adresse`, url:GS(`"${addr}" (entreprise OR société OR SARL OR SAS)`)},
        {label:`Sur Google Maps`, url:'https://www.google.com/maps/search/' + encodeURIComponent(addr)}
      ];
    }
    function dorkGroup(title, links){
      return `<div class="dork-cat">${escapeHtml(title)}</div>` + links.map(l => `<a href="${escapeHtml(l.url)}" target="_blank" rel="noopener">↗ ${escapeHtml(l.label)}</a>`).join('');
    }
    function renderDorksHtml(card){
      if((card.source_id !== 'recherche_entreprises' && card.source_id !== 'rna') || card.status !== 'found') return '';
      const siren = sirenOf(card);
      const rp = card.raw_preview || {};
      const cat = card.source_id === 'rna' ? 'Association — ' : 'Entreprise — ';
      let html = dorkGroup(cat + (card.title || ''), companyDorks(card.title || '', siren));
      (rp.dirigeants_pivot || []).forEach(d => {
        const nm = `${String(d.prenoms || '').split(' ')[0]} ${d.nom || ''}`.trim();
        if(nm) html += dorkGroup('Dirigeant — ' + nm, personDorks(nm));
      });
      if(rp.adresse_pivot) html += dorkGroup('Adresse', addressDorks(rp.adresse_pivot));
      return `<details class="dorks"><summary>🔎 Pistes externes (Google dorks + portails)</summary>${html}</details>`;
    }

    function renderCard(card, idx){
      const fl = friendlyLink(card);
      const link = fl ? `<a class="srclink" href="${escapeHtml(fl.url)}" target="_blank" rel="noopener">${escapeHtml(fl.label)}</a>` : '';
      const sub = card.subtitle ? `<div class="result-sub">${escapeHtml(card.subtitle)}</div>` : '';
      const summary = card.summary ? `<p>${escapeHtml(card.summary).replace(/\n/g, '<br>')}</p>` : '';
      const prov = card.provenance ? `<div class="prov">↳ via ${escapeHtml(card.provenance)}</div>` : '';
      const idxAttr = (idx === undefined || idx === null) ? '' : ` data-idx="${idx}" onclick="osirisCardPanel(event, ${idx})"`;
      return `<article class="result clickable"${idxAttr}>
        <div class="top"><span class="srcname">${sourceIcon(card)} ${escapeHtml(sourceTitle(card))}</span>${statusBadge(card.status)}</div>
        ${prov}<h3>${escapeHtml(card.title || sourceTitle(card))}</h3>
        ${sub}${summary}${link}${renderDorksHtml(card)}
      </article>`;
    }

    function renderResponse(payload){
      hideLoading();
      const rawCards = payload?.results?.raw_cards || [];
      const sources = payload?.sources_consulted || [];
      const cannot = payload?.cannot_conclude || [];

      const cardsHtml = rawCards.length
        ? rawCards.map((c, i) => renderCard(c, i)).join('')
        : `<article class="result"><div class="top"><span class="srcname">∅ Résultats</span><span class="tag key">vide</span></div><h3>Aucun résultat exploitable</h3><p>Essaie un SIREN, une adresse ou une commune.</p></article>`;

      const sourcesLine = sources.length
        ? sources.map(s => `${escapeHtml((cards[s.source_id] || {}).title || s.source_id)} : ${escapeHtml(s.status)}`).join('  ·  ')
        : 'Aucune source interrogée';
      const sourcesHtml = `<article class="result full"><div class="top"><span class="srcname">🔎 Sources consultées</span><span class="tag open">${sources.length}</span></div><p>${sourcesLine}</p></article>`;

      const cannotHtml = cannot.length
        ? `<article class="result full"><div class="top"><span class="srcname">🛡 Ce qu’on ne peut pas conclure</span></div>${cannot.map(c => `<p>• ${escapeHtml(c)}</p>`).join('')}</article>`
        : '';

      let investHtml = '';
      const inv = payload?.investigation;
      if (inv) {
        const warn = inv.budget_reached ? (inv.time_budget_reached ? ' · ⚠️ budget temps atteint (résultats partiels)' : ' · ⚠️ budget atteint (résultats partiels)') : '';
        investHtml = `<article class="result full" style="border-color:rgba(167,139,250,.5)"><div class="top"><span class="srcname">🕸️ Investigation automatique</span><span class="tag open">${inv.entities}</span></div><p>${inv.entities} entité(s) reliées · ${inv.pivots_explored} rebond(s) explorés · profondeur ${inv.depth}${warn}</p></article>`;
      }

      // Pagination entreprises : afficher le TOTAL réel + navigation de pages.
      let pagHtml = '';
      const pag = payload?.results?.pagination;
      if (pag && pag.total_results > pag.shown) {
        const totalPages = Math.max(1, Math.ceil(pag.total_results / (pag.per_page || 10)));
        const nav = inv ? '' :
          (pag.page > 1 ? `<button class="chip" onclick="runDemo(${pag.page - 1})">◀ Page précédente</button> ` : '') +
          (pag.page < totalPages ? `<button class="chip" onclick="runDemo(${pag.page + 1})">Page suivante ▶</button>` : '');
        pagHtml = `<article class="result full"><div class="top"><span class="srcname">🏢 ${pag.total_results} entreprise(s) au total</span><span class="tag open">page ${pag.page}/${totalPages}</span></div><p>${pag.shown} affichée(s) sur cette page — l'absence ci-dessous ne signifie pas l'absence dans le registre.</p>${nav ? `<div class="chips">${nav}</div>` : ''}</article>`;
      }

      document.getElementById('results').innerHTML = investHtml + pagHtml + cardsHtml + sourcesHtml + cannotHtml;
      LAST_PAYLOAD = payload; LAST_CARDS = rawCards;
      const eb = document.getElementById('export-bar'); if (eb) eb.style.display = rawCards.length ? '' : 'none';
      if (VIEW === 'graph') renderGraph(payload);
    }

    let LAST_PAYLOAD = null;
    let LAST_CARDS = [];
    let VIEW = 'list';
    let NETWORK = null;

    const GRAPH_GROUPS = {
      origin:  {shape:'dot', size:26, color:{background:'#0a2a33', border:'#6ae4ff'}, font:{color:'#eaf6ff', size:16}},
      company: {shape:'box', color:{background:'#0e2233', border:'#6ae4ff'}, font:{color:'#eaf6ff'}},
      person:  {shape:'ellipse', color:{background:'#241a3a', border:'#a78bfa'}, font:{color:'#f0ecff'}},
      address: {shape:'diamond', color:{background:'#10261a', border:'#7cffb2'}, font:{color:'#eaffea'}},
      commune: {shape:'hexagon', color:{background:'#15202b', border:'#9aa8bc'}, font:{color:'#dfe7f0'}},
      bodacc:  {shape:'triangle', color:{background:'#2a2410', border:'#ffd166'}, font:{color:'#ffe9c2'}},
      association: {shape:'box', color:{background:'#102233', border:'#5eead4'}, font:{color:'#d7fff6'}},
      finding: {shape:'star', color:{background:'#3a2a10', border:'#ffb454'}, font:{color:'#ffe9c2'}}
    };
    let CUR_NODES = null, CUR_EDGES = null, CURRENT_NODE_ID = null;

    function nodeKind(id){
      if(id === 'ROOT') return 'origin';
      return {C:'company', P:'person', A:'address', F:'finding', B:'bodacc', M:'commune', R:'association'}[id[0]] || '?';
    }

    function showNodePanel(nodeId){
      if(!CUR_NODES) return;
      const node = CUR_NODES.get(nodeId);
      if(!node) return;
      CURRENT_NODE_ID = nodeId;
      const kind = nodeKind(nodeId);
      const label = node.label || '';
      let dorks = [], typeLabel = 'Trouvaille';
      if(kind === 'company'){ typeLabel = 'Entreprise'; const s = nodeId.startsWith('C:') && /^\d+$/.test(nodeId.slice(2)) ? nodeId.slice(2) : ''; dorks = companyDorks(label, s); }
      else if(kind === 'association'){ typeLabel = 'Association'; dorks = companyDorks(label, node.siren || ''); }
      else if(kind === 'person'){ typeLabel = 'Personne'; dorks = personDorks(label); }
      else if(kind === 'address'){ typeLabel = 'Adresse'; dorks = addressDorks(label); }
      else if(node.url){ dorks = [{label:'Ouvrir le lien', url:node.url}]; }
      const links = dorks.map(l => `<a href="${escapeHtml(l.url)}" target="_blank" rel="noopener">↗ ${escapeHtml(l.label)}</a>`).join('');
      const enqueteSection = ['company', 'person', 'address', 'association'].includes(kind)
        ? `<div class="np-section">
             <button class="btn primary" style="width:100%" onclick="investigateNode()">🔍 Enquêter sur ce nœud</button>
             <p class="np-help">Cherche tout ce qui est lié (dirigeants, adresses, autres sociétés…) et l'<b>ajoute au graphe</b>. Les nouvelles entités clignotent en jaune.</p>
           </div>` : '';
      const dorksSection = links
        ? `<div class="np-section">
             <div class="np-h">🔎 Pistes externes (recherche manuelle)</div>
             <p class="np-help">Ouvre Google / Pappers / LinkedIn dans un nouvel onglet. À toi de fouiller — rien n'est ajouté tout seul.</p>
             ${links}
           </div>` : '';
      const findingSection = `<div class="np-section">
             <div class="np-h">➕ Noter une trouvaille</div>
             <p class="np-help">Tu as trouvé un truc utile (via les pistes ci-dessus) ? Ajoute-le au graphe, relié à ce nœud.</p>
             <input id="nf-label" placeholder="Titre (ex : Article presse 2023, profil LinkedIn…)" />
             <input id="nf-url" placeholder="Lien https://… (optionnel)" />
             <button class="btn" style="margin-top:8px;width:100%" onclick="addFinding()">Ajouter au graphe</button>
           </div>`;
      const panel = document.getElementById('node-panel');
      panel.innerHTML = `<span class="np-close" onclick="closeNodePanel()">✕</span>
        <div class="np-type">${escapeHtml(typeLabel)}</div>
        <h4>${escapeHtml(label)}</h4>
        ${enqueteSection}${dorksSection}${findingSection}`;
      panel.style.display = '';
      panel.scrollIntoView({behavior:'smooth', block:'nearest'});
    }
    function closeNodePanel(){ const p = document.getElementById('node-panel'); p.style.display = 'none'; p.innerHTML = ''; }

    function investigateNode(){
      if(!CUR_NODES || !CURRENT_NODE_ID) return;
      const node = CUR_NODES.get(CURRENT_NODE_ID);
      if(!node) return;
      const kind = nodeKind(CURRENT_NODE_ID);
      let url, label = node.label || '';
      if(kind === 'company'){
        const siren = node.siren || (CURRENT_NODE_ID.startsWith('C:') && /^\d+$/.test(CURRENT_NODE_ID.slice(2)) ? CURRENT_NODE_ID.slice(2) : '');
        const q = siren || node.label;
        url = '/investigate?q=' + encodeURIComponent(q);
        setMode('entreprise'); document.getElementById('q').value = q;
      } else if(kind === 'person'){
        const nom = node.nom || node.label, prenoms = node.prenoms || '';
        url = '/investigate?nom=' + encodeURIComponent(nom) + (prenoms ? '&prenoms=' + encodeURIComponent(prenoms) : '');
        setMode('personne'); document.getElementById('p-nom').value = nom; document.getElementById('p-prenom').value = prenoms;
      } else if(kind === 'address' || kind === 'association'){
        url = '/investigate?q=' + encodeURIComponent(node.label);
        setMode('entreprise'); document.getElementById('q').value = node.label;
      } else { return; }
      DEEP = true;
      const b = document.getElementById('deep-toggle'); b.textContent = '🔎 Investigation auto : ON'; b.classList.add('active');
      closeNodePanel();
      toast('🔍 Enquête sur « ' + label + ' »… (les nouveautés vont clignoter)');
      fetch(url)
        .then(r => { if(r.status === 401){ window.location.replace('/login'); return Promise.reject('auth'); } if(!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
        .then(p => { mergeGraphIntoCurrent(p && p.graph, label); })
        .catch(e => { if(e !== 'auth') toast('⚠️ Erreur : ' + (e.message || e)); });
    }

    function nudgePhysics(){
      if(!NETWORK) return;
      try{ NETWORK.setOptions({physics:true}); setTimeout(() => { try{ NETWORK.setOptions({physics:false}); }catch(e){} }, 1600); }catch(e){}
    }
    function flashNewNodes(ids){
      if(!ids || !ids.length || !CUR_NODES) return;
      ids.forEach(id => { try{ CUR_NODES.update({id, borderWidth:4, shadow:{enabled:true, color:'#ffd166', size:26, x:0, y:0}}); }catch(e){} });
      try{ NETWORK.selectNodes(ids); }catch(e){}
      setTimeout(() => { ids.forEach(id => { try{ CUR_NODES.update({id, borderWidth:1.5, shadow:{enabled:false}}); }catch(e){} }); try{ NETWORK.unselectAll(); }catch(e){} }, 4500);
    }
    function mergeGraphIntoCurrent(g, sourceLabel){
      if(!g || !g.nodes){ toast('Aucun résultat.'); return; }
      if(!CUR_NODES || !NETWORK){
        LAST_PAYLOAD = {query:sourceLabel, graph:g, results:{raw_cards:[]}, sources_consulted:[], cannot_conclude:[]};
        VIEW = 'graph'; setView('graph'); return;
      }
      const existing = new Set(CUR_NODES.getIds());
      const added = [];
      g.nodes.forEach(n => {
        if(!existing.has(n.id)){
          CUR_NODES.add(Object.assign({}, n, {group:n.type}));
          added.push(n.id);
          if(LAST_PAYLOAD && LAST_PAYLOAD.graph) LAST_PAYLOAD.graph.nodes.push(n);
        }
      });
      const eKeys = new Set(CUR_EDGES.get().map(e => e.from + '>' + e.to + '>' + (e.label || '')));
      let i = 0;
      g.edges.forEach(e => {
        if(!eKeys.has(e.from + '>' + e.to + '>' + e.relation)){
          CUR_EDGES.add({id:'M' + Date.now() + '_' + (i++), from:e.from, to:e.to, label:e.relation, arrows:'to', font:{color:'#9aa8bc', size:10, strokeWidth:0}, color:{color:'rgba(255,255,255,.22)'}});
          if(LAST_PAYLOAD && LAST_PAYLOAD.graph) LAST_PAYLOAD.graph.edges.push(e);
        }
      });
      nudgePhysics();
      flashNewNodes(added);
      toast(added.length ? `✅ +${added.length} entité(s) ajoutée(s) — elles clignotent en jaune` : 'Rien de nouveau (déjà dans le graphe)');
    }

    let TOAST_T = null;
    function toast(msg){
      let t = document.getElementById('toast');
      if(!t){ t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
      t.textContent = msg; t.style.display = '';
      clearTimeout(TOAST_T); TOAST_T = setTimeout(() => { t.style.display = 'none'; }, 4000);
    }
    function addFinding(){
      if(!CUR_NODES || !CURRENT_NODE_ID) return;
      const label = (document.getElementById('nf-label').value || '').trim();
      const url = (document.getElementById('nf-url').value || '').trim();
      if(!label){ document.getElementById('nf-label').focus(); return; }
      const fid = 'F:' + Date.now();
      CUR_NODES.add({id:fid, label, group:'finding', title:url || label, url});
      CUR_EDGES.add({id:'E' + fid, from:CURRENT_NODE_ID, to:fid, label:'trouvaille', arrows:'to', color:{color:'#ffb454'}, font:{color:'#ffb454', size:10}});
      nudgePhysics();
      flashNewNodes([fid]);
      closeNodePanel();
      toast('✅ Trouvaille ajoutée au graphe (en jaune)');
    }

    function getGraphPng(){
      const c = document.querySelector('#graph canvas');
      if(!c) return null;
      const tmp = document.createElement('canvas');
      tmp.width = c.width; tmp.height = c.height;
      const ctx = tmp.getContext('2d');
      ctx.fillStyle = '#070b12'; ctx.fillRect(0, 0, tmp.width, tmp.height);
      ctx.drawImage(c, 0, 0);
      return tmp.toDataURL('image/png');
    }
    function exportGraphPng(){
      const png = getGraphPng();
      if(!png){ alert('Ouvre d\'abord la vue 🕸️ Graphe, puis réessaie.'); return; }
      const a = document.createElement('a');
      a.href = png; a.download = 'open-radar-graphe.png'; a.click();
    }
    function exportReport(){
      const p = LAST_PAYLOAD;
      if(!p){ alert('Lance une recherche d\'abord.'); return; }
      const png = getGraphPng();
      const cards = (p.results && p.results.raw_cards) || [];
      const sources = p.sources_consulted || [];
      const cannot = p.cannot_conclude || [];
      const inv = p.investigation;
      const date = new Date().toLocaleString('fr-FR');
      const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
      const cardsHtml = cards.map(c => `<div class="rc"><div class="rt">${esc(c.title)}</div>${c.subtitle ? `<div class="rs">${esc(c.subtitle)}</div>` : ''}${c.provenance ? `<div class="rp">↳ via ${esc(c.provenance)}</div>` : ''}<div class="rsum">${esc(c.summary).replace(/\n/g, '<br>')}</div></div>`).join('');
      const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>OSIRIS V3 — Rapport d'enquête</title>`
        + `<style>body{font-family:Arial,Helvetica,sans-serif;color:#111;max-width:820px;margin:24px auto;padding:0 16px;line-height:1.5}`
        + `h1{font-size:22px;margin-bottom:2px}h2{font-size:15px;border-bottom:1px solid #ddd;padding-bottom:4px;margin-top:22px}`
        + `.meta{color:#555;font-size:13px}.rc{border:1px solid #ddd;border-radius:8px;padding:10px;margin:8px 0}`
        + `.rt{font-weight:bold}.rs{color:#0066cc;font-family:monospace;font-size:13px}.rp{color:#770055;font-size:12px;margin:2px 0}`
        + `.rsum{color:#333;font-size:13px;margin-top:4px}.disc{color:#666;font-size:12px;margin-top:14px;border-top:1px solid #eee;padding-top:8px}`
        + `img{max-width:100%;border:1px solid #ddd;border-radius:8px}@media print{body{margin:0}}</style></head><body>`
        + `<h1>OSIRIS V3 — Rapport d'enquête</h1>`
        + `<div class="meta">Requête : <b>${esc(p.query)}</b> &middot; ${esc(date)}${inv ? ` &middot; investigation profondeur ${esc(inv.depth)}, ${esc(inv.entities)} entités` : ''}</div>`
        + (png ? `<h2>Graphe des liens</h2><img src="${png}">` : '')
        + `<h2>Entités (${cards.length})</h2>${cardsHtml || '<p>Aucune.</p>'}`
        + `<h2>Sources consultées</h2><p>${sources.map(s => esc((s.source_id || '') + ' : ' + (s.status || ''))).join(' &middot; ') || '—'}</p>`
        + `<h2>Ce qu'on ne peut pas conclure</h2><ul>${cannot.map(c => `<li>${esc(c)}</li>`).join('')}</ul>`
        + `<p class="disc">OSIRIS — agrégateur de données publiques officielles. Ce rapport ne constitue pas une conclusion juridique ou financière ; vérifier les sources officielles.</p>`
        + `<scr` + `ipt>window.onload=function(){setTimeout(function(){window.print();},400);};</scr` + `ipt></body></html>`;
      const w = window.open('', '_blank');
      if(!w){ alert('Autorise les pop-ups pour générer le rapport (puis « Enregistrer en PDF »).'); return; }
      w.document.write(html); w.document.close();
    }

    function setView(view){
      VIEW = view;
      const isGraph = view === 'graph';
      document.getElementById('view-list').classList.toggle('active', !isGraph);
      document.getElementById('view-graph').classList.toggle('active', isGraph);
      document.getElementById('results').style.display = isGraph ? 'none' : '';
      document.getElementById('graph-wrap').style.display = isGraph ? '' : 'none';
      if (isGraph) renderGraph(LAST_PAYLOAD);
    }

    function renderGraph(payload){
      const container = document.getElementById('graph');
      const stats = document.getElementById('graph-stats');
      if (typeof vis === 'undefined'){
        container.innerHTML = '<p style="padding:24px;color:#ffd166">Graphe indisponible : la librairie n\'a pas pu se charger (vérifie ta connexion internet).</p>';
        return;
      }
      const g = payload && payload.graph;
      if (!g || !g.nodes || !g.nodes.length){
        container.innerHTML = '<p style="padding:24px;color:#9aa8bc">Pas assez de données pour un graphe. Lance une recherche entreprise (et active 🔎 Investigation auto pour révéler plus de liens).</p>';
        stats.textContent = '';
        NETWORK = null;
        return;
      }
      const nodes = new vis.DataSet(g.nodes.map(n => {
        const node = Object.assign({}, n, {group:n.type});
        if (n.type === 'company' && n.bodacc){ node.borderWidth = 3; node.color = {background:'#0e2233', border:'#ffd166'}; }
        return node;
      }));
      const edges = new vis.DataSet(g.edges.map((e, i) => ({
        id:i, from:e.from, to:e.to, label:e.relation, arrows:'to',
        font:{color:'#9aa8bc', size:10, strokeWidth:0}, color:{color:'rgba(255,255,255,.22)'}
      })));
      const options = {
        groups: GRAPH_GROUPS,
        nodes: {font:{size:13}, borderWidth:1.5, margin:8},
        edges: {smooth:{type:'dynamic'}},
        physics: {stabilization:true, barnesHut:{springLength:150, gravitationalConstant:-9000}},
        interaction: {hover:true, tooltipDelay:120}
      };
      container.innerHTML = '';
      closeNodePanel();
      CUR_NODES = nodes; CUR_EDGES = edges;
      NETWORK = new vis.Network(container, {nodes, edges}, options);
      NETWORK.on('click', params => { if(params.nodes && params.nodes.length) showNodePanel(params.nodes[0]); });
      NETWORK.once('stabilizationIterationsDone', () => { try{ NETWORK.setOptions({physics:false}); }catch(e){} });
      const s = g.stats || {};
      stats.innerHTML = `${s.companies||0} entreprise(s) · ${s.persons||0} personne(s) · ${s.addresses||0} adresse(s). Glisse les nœuds, zoome à la molette. <b style="color:var(--amber)">👉 Clique un nœud pour ses pistes (dorks) + « Enquêter ».</b>`;
    }

    let DEEP = false;
    let MODE = 'entreprise';
    function toggleDeep(){
      DEEP = !DEEP;
      const btn = document.getElementById('deep-toggle');
      btn.textContent = '🔎 Investigation auto : ' + (DEEP ? 'ON' : 'OFF');
      btn.classList.toggle('active', DEEP);
      (MODE === 'personne' ? runPerson : runDemo)();
    }

    function collectFilters(){
      const v = id => (document.getElementById(id) ? document.getElementById(id).value : '').trim();
      const c = id => !!(document.getElementById(id) && document.getElementById(id).checked);
      const f = {naf:v('f-naf'), departement:v('f-dept'), code_postal:v('f-cp'), effectif:v('f-effectif'),
                 categorie:v('f-categorie'), etat:v('f-etat'), rge:c('f-rge'), ess:c('f-ess'),
                 qualiopi:c('f-qualiopi'), bio:c('f-bio'), association:c('f-association')};
      const parts = [];
      Object.keys(f).forEach(k => {
        const val = f[k];
        if(val === true) parts.push(k + '=true');
        else if(val) parts.push(k + '=' + encodeURIComponent(val));
      });
      return parts.join('&');
    }

    async function runDemo(page){
      const q = currentQuery();
      const p = Math.max(1, Number(page) || 1);
      renderLoading(q + (DEEP ? ' (investigation…)' : ''));
      try{
        let url;
        if(DEEP){
          url = '/investigate?q=' + encodeURIComponent(q);
        }else{
          const fp = collectFilters();
          url = '/search?q=' + encodeURIComponent(q) + (p > 1 ? '&page=' + p : '') + (fp ? '&' + fp : '');
        }
        const response = await fetch(url);
        if(response.status === 401){ window.location.replace('/login'); return; }
        if(!response.ok) throw new Error(`HTTP ${response.status}`);
        renderResponse(await response.json());
      }catch(error){
        renderError(error);
      }
    }

    function setMode(mode){
      MODE = mode;
      const isPers = mode === 'personne';
      document.getElementById('form-entreprise').style.display = isPers ? 'none' : '';
      document.getElementById('form-personne').style.display = isPers ? '' : 'none';
      document.getElementById('mode-ent').classList.toggle('active', !isPers);
      document.getElementById('mode-per').classList.toggle('active', isPers);
      document.getElementById('results').innerHTML = '';
    }

    async function runPerson(){
      const nom = document.getElementById('p-nom').value.trim();
      const prenom = document.getElementById('p-prenom').value.trim();
      if(!nom){ renderError(new Error('Indique au moins un nom de famille.')); return; }
      renderLoading(`${prenom} ${nom}`.trim() + (DEEP ? ' (investigation…)' : ''));
      try{
        const params = 'nom=' + encodeURIComponent(nom) + (prenom ? '&prenoms=' + encodeURIComponent(prenom) : '');
        const url = (DEEP ? '/investigate?' : '/person?') + params;
        const response = await fetch(url);
        if(response.status === 401){ window.location.replace('/login'); return; }
        if(!response.ok) throw new Error(`HTTP ${response.status}`);
        renderResponse(await response.json());
      }catch(error){
        renderError(error);
      }
    }

    function setDemo(v){
      document.getElementById('q').value=v;
      document.querySelectorAll('.chip').forEach(b=>b.classList.toggle('active', b.textContent.toLowerCase().includes(v.split(' ')[0].toLowerCase())));
      runDemo();
    }

    function downloadMarkdown(){
      window.location.href = '/report/markdown?q=' + encodeURIComponent(currentQuery());
    }
    function downloadCsv(file){
      window.location.href = '/report/csv?q=' + encodeURIComponent(currentQuery()) + '&file=' + encodeURIComponent(file);
    }
    // ---------- Aperçu rapide d'une carte (pop-up relié aux résultats) — couche UI additive ----------
    function cardDorkLinks(card){
      const siren = sirenOf(card);
      const sid = card.source_id;
      if(sid === 'recherche_entreprises' || sid === 'bodacc' || sid === 'rna') return companyDorks(card.title || '', siren);
      if(sid === 'adresse') return addressDorks(card.title || '');
      const t = card.title || ''; return t ? [{label:`"${t}"`, url:GS(`"${t}"`)}] : [];
    }
    function osirisCardPanel(ev, idx){
      if(ev){ const t = ev.target; if(t && t.closest && t.closest('a, summary, details, button')) return; }
      const card = LAST_CARDS[idx]; if(!card) return;
      let pop = document.getElementById('card-pop');
      if(!pop){
        pop = document.createElement('div'); pop.id = 'card-pop'; pop.className = 'card-pop'; document.body.appendChild(pop);
        const bd = document.createElement('div'); bd.id = 'card-pop-bd'; bd.className = 'card-pop-bd'; bd.onclick = osirisCardClose; document.body.appendChild(bd);
      }
      const fl = friendlyLink(card);
      const link = fl ? `<a class="srclink" href="${escapeHtml(fl.url)}" target="_blank" rel="noopener">${escapeHtml(fl.label)}</a>` : '';
      const sub = card.subtitle ? `<div class="result-sub">${escapeHtml(card.subtitle)}</div>` : '';
      const summary = card.summary ? `<p class="np-help">${escapeHtml(card.summary).replace(/\n/g, '<br>')}</p>` : '';
      const links = cardDorkLinks(card).map(l => `<a href="${escapeHtml(l.url)}" target="_blank" rel="noopener">↗ ${escapeHtml(l.label)}</a>`).join('');
      const dorksSection = links ? `<div class="np-section"><div class="np-h">🔎 Pistes externes</div><p class="np-help">Ouvre Google / Pappers / annuaire dans un nouvel onglet.</p>${links}</div>` : '';
      pop.innerHTML = `<span class="np-close" onclick="osirisCardClose()">✕</span>
        <div class="np-type">${escapeHtml(sourceTitle(card))}</div>
        <h4>${escapeHtml(card.title || sourceTitle(card))}</h4>
        ${sub}${summary}${link}${dorksSection}`;
      document.getElementById('card-pop-bd').style.display = 'block';
      pop.style.display = 'block';
    }
    function osirisCardClose(){ const p = document.getElementById('card-pop'), b = document.getElementById('card-pop-bd'); if(p) p.style.display = 'none'; if(b) b.style.display = 'none'; }
    document.addEventListener('keydown', e => { if(e.key === 'Escape') osirisCardClose(); });

    document.getElementById('q').addEventListener('keydown', event => { if(event.key === 'Enter') runDemo(); });
    ['p-nom', 'p-prenom'].forEach(id => document.getElementById(id).addEventListener('keydown', event => { if(event.key === 'Enter') runPerson(); }));
    runDemo();

    // ---------- Écran d'intro (splash) : animation du logo → bouton ENTRER ----------
    function enterApp(){
      const s = document.getElementById('splash');
      if(!s) return;
      s.classList.add('hide');
      setTimeout(() => { s.style.display = 'none'; }, 800);
    }
    (function initSplash(){
      const s = document.getElementById('splash');
      if(!s) return;
      const v = document.getElementById('splash-logo');
      const btn = document.getElementById('splash-enter');
      const hint = document.getElementById('splash-hint');
      let done = false;
      function ready(){ if(done) return; done = true; if(btn) btn.style.display = ''; if(hint) hint.style.display = 'none'; }
      if(v){
        v.addEventListener('ended', ready);
        const p = v.play && v.play();
        if(p && p.catch) p.catch(() => {});  // autoplay bloqué : le garde-fou ci-dessous prend le relais
      }
      setTimeout(ready, 7000);  // garde-fou si l'événement "ended" ne se déclenche pas
    })();

    // ---------- Feedback / Questions ----------
    function openFeedback(){
      const m = document.getElementById('feedback-modal');
      if(m){ m.style.display = 'flex'; const t=document.getElementById('fb-msg'); if(t) setTimeout(()=>t.focus(),50); }
    }
    function closeFeedback(){
      const m = document.getElementById('feedback-modal'); if(m) m.style.display = 'none';
      const st = document.getElementById('fb-status'); if(st) st.textContent = '';
    }
    async function sendFeedback(){
      const typeEl = document.querySelector('input[name="fb-type"]:checked');
      const msg = (document.getElementById('fb-msg').value || '').trim();
      const st = document.getElementById('fb-status');
      const btn = document.getElementById('fb-send');
      if(!msg){ if(st){ st.textContent = '✋ Écris au moins un message.'; st.style.color = 'var(--amber)'; } return; }
      const payload = {
        type: typeEl ? typeEl.value : 'feedback',
        name: (document.getElementById('fb-name').value || '').trim(),
        email: (document.getElementById('fb-email').value || '').trim(),
        message: msg,
        url: location.href,
        ua: navigator.userAgent
      };
      if(btn){ btn.disabled = true; btn.textContent = 'Envoi…'; }
      if(st){ st.textContent = ''; }
      try{
        const r = await fetch('/feedback', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)});
        if(r.status === 401){ window.location.replace('/login'); return; }
        const d = await r.json();
        if(d && d.ok){
          if(st){ st.textContent = '✅ Merci ! Ton retour a bien été envoyé.'; st.style.color = 'var(--green)'; }
          document.getElementById('fb-msg').value = '';
          setTimeout(closeFeedback, 1800);
        }else{
          if(st){ st.textContent = '⚠️ ' + ((d && d.error) || 'Échec de l\'envoi.'); st.style.color = 'var(--red)'; }
        }
      }catch(e){
        if(st){ st.textContent = '⚠️ Erreur réseau : ' + (e.message || e); st.style.color = 'var(--red)'; }
      }finally{
        if(btn){ btn.disabled = false; btn.textContent = 'Envoyer'; }
      }
    }

    // ---------- Déconnexion ----------
    async function osirisLogout(){
      try{ await fetch('/logout', {method:'POST'}); }catch(e){}
      window.location.replace('/login');
    }

    // ---------- Bouton « Mise à jour » : détecte une nouvelle version déployée ----------
    // Le serveur sert le HTML/JS/CSS en no-cache → recharger suffit à récupérer la
    // dernière version, SANS vider les cookies ni recréer le raccourci (session conservée).
    (function osirisUpdateWatch(){
      var BUILD = null;
      function banner(){
        var b = document.getElementById('update-banner');
        if(b) return b;
        b = document.createElement('div');
        b.id = 'update-banner';
        b.innerHTML = '<span>🔄 Nouvelle version d\'OSIRIS disponible</span>' +
          '<button type="button" onclick="window.location.reload()">Mettre à jour</button>';
        document.body.appendChild(b);
        return b;
      }
      async function check(initial){
        try{
          var r = await fetch('/version', {cache:'no-store'});
          if(!r.ok) return;
          var v = (await r.json()).version;
          if(initial){ BUILD = v; return; }
          if(BUILD && v && v !== BUILD){ banner().classList.add('show'); }
        }catch(e){}
      }
      check(true);
      setInterval(check, 90000);
      document.addEventListener('visibilitychange', function(){ if(!document.hidden) check(false); });
    })();
