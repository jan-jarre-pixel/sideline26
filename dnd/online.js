/*
 * D&D Charakterbögen – Supabase Cloud Adapter
 * Original UI and rule descriptions remain in index.html.
 * Browser only receives a publishable key. Authorization is enforced by SQL RLS.
 */
(() => {
  'use strict';
  const config = window.DND_CLOUD_CONFIG || {};
  const url = String(config.url || '').trim();
  const key = String(config.publishableKey || '').trim();
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url) || !key || key.includes('HIER_EINFUEGEN')) {
    setSt('Offline-Vorschau · Online-Speicherung noch nicht eingerichtet.');
    return;
  }
  if (!window.supabase?.createClient) {
    setSt('Verbindung nicht möglich: Supabase-Bibliothek konnte nicht geladen werden.');
    return;
  }
  const api = window.supabase.createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  const allowedKeys = new Set(IDS);
  const state = { user: null, role: 'guest', ready: false, seq: 0, busy: false, channel: null, slots: [] };
  let refreshBusy = false;
  // Protect the legacy inline handlers from malformed or hostile JSON values.
  function normalizeSheet(raw, id) {
    const defaults = clone(D[id]);
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const out = { ...defaults };
    const textKeys = ['name','player','cls','race','bg','speed','langs','atk','sp','sl','rs','ft','gear','n','cb'];
    for (const k of textKeys) if (typeof source[k] === 'string') out[k] = source[k].slice(0, 20000);
    const nums = {tmp:[0,9999],hdUsed:[0,100],insp:[0,1],sa:[0,5],initX:[-100,100],joat:[0,1],lvl:[1,20],ac:[0,100],hpMax:[1,9999],hp:[0,9999],hd:[1,20]};
    for (const [k,[min,max]] of Object.entries(nums)) {
      const n = Number(source[k]);
      if (source[k] !== undefined && Number.isFinite(n)) out[k] = Math.max(min,Math.min(max,Math.trunc(n)));
    }
    for (const k of ['ab','sv','ds']) {
      if (Array.isArray(source[k])) out[k] = defaults[k].map((v,i) => {
        const n=Number(source[k][i]);return Number.isFinite(n)?Math.max(k==='ab'?1:0,Math.min(k==='ab'?30:k==='sv'?1:3,Math.trunc(n))):v;
      });
    }
    for (const k of ['slU','rsU']) {
      out[k]={};
      if (source[k] && typeof source[k] === 'object' && !Array.isArray(source[k])) {
        for (const [i,v] of Object.entries(source[k])) {
          if (!/^(0|[1-9][0-9]?)$/.test(i)) continue;
          const n=Number(v);if (Number.isFinite(n)) out[k][i]=Math.max(0,Math.min(99,Math.trunc(n)));
        }
      }
    }
    if (source.sk && typeof source.sk === 'object' && !Array.isArray(source.sk)) {
      out.sk={...defaults.sk};
      for (const [name,v] of Object.entries(source.sk)) {
        if (!SK.some(x=>x[0]===name)) continue;
        const n=Number(v);if ([0,1,2].includes(n)) out.sk[name]=n;
      }
    }
    out.char=id;
    return out;
  }
  const original = { draw, chooser, picker, codeCard, overview, save, imp };
  const head = () => `${location.origin}${location.pathname}`;
  const safeMessage = e => {
    const code = String(e?.code || '');
    if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit') return 'Zu viele Anfragen. Bitte später erneut versuchen.';
    if (code === 'email_address_invalid') return 'Bitte eine gültige E-Mail-Adresse eingeben.';
    return String(e?.message || 'Ein unbekannter Fehler ist aufgetreten.');
  };
  function textNotice(t) { setSt(t); tst(t); }
  function accountLine() {
    const el = document.getElementById('account');
    if (!el) return;
    el.innerHTML = state.user
      ? `<div class="row"><span class="note">Angemeldet als <b>${esc(state.user.email || 'Spieler')}</b> · ${state.role === 'gm' ? 'Spielleiter' : state.role === 'player' ? 'Spieler' : 'Noch keine Rolle'}</span><button class="b" onclick="cloudLogout()">Abmelden</button></div>`
      : '';
  }
  function showLogin() {
    return `<div class="card"><h3>Online-Charakterbögen</h3>
      <h2>Mit E-Mail anmelden</h2>
      <p>Du erhältst einen einmaligen Anmeldelink. Danach kannst du deinen Charakter mit einem privaten Einladungscode freischalten.</p>
      <form onsubmit="cloudLogin();return false" class="row">
        <input id="loginEmail" class="w" style="flex:1;min-width:200px" type="email" autocomplete="email" placeholder="Deine E-Mail-Adresse" required>
        <button class="b" type="submit">Anmeldelink senden</button>
      </form><p id="loginFeedback" class="note">Bitte auch den Spamordner prüfen. Für das kostenlose Supabase-Projekt gelten E-Mail-Versandlimits.</p></div>`;
  }
  function roleChooser() {
    return `<div class="card"><h3>Charakter auswählen</h3>
      <p>Gib den <b>privaten Einladungscode</b> ein, den du vom Spielleiter bekommen hast. Jeder Code gehört zu genau einem Charakter.</p>
      <div class="grid">${IDS.map(k => `<div class="act"><b>${esc(D[k].name)}</b><p>${esc(D[k].cls)}</p>
      <label class="note" for="invite_${k}">Einladungscode</label>
      <input id="invite_${k}" class="w" type="password" autocomplete="off" placeholder="Einladungscode">
      <button class="b" style="margin-top:6px" onclick="cloudClaim('${k}')">Diesen Charakter übernehmen</button></div>`).join('')}</div>
      <p class="note">Bereits vergebenen Charakteren kann niemand sonst beitreten.</p></div>
      <div class="card"><h3>Spielleiter</h3><p class="note">Nur für den Spielleiter: privaten Spielleiter-Code eingeben.</p>
      <div class="row"><input id="gmCode" type="password" class="w" style="flex:1;min-width:140px" autocomplete="off" placeholder="Spielleiter-Code">
      <button class="b" onclick="cloudActivateGM()">Spielleiteransicht aktivieren</button></div></div>`;
  }
  chooser = showLogin;
  picker = roleChooser;
  codeCard = function () {
    if (state.role !== 'player') return '';
    return original.codeCard().replace('Mit dem Code kann ein Stand auf ein anderes Gerät oder zum Spielleiter. Alles wird sonst nur in diesem Browser gespeichert.',
      'Dein Charakter wird automatisch online gespeichert. Dieser Code ist nur eine zusätzliche manuelle Sicherung.');
  };
  overview = function () {
    return original.overview().replace(
      'Spieler schicken dir ihren Code (Button „Code erzeugen“ in ihrem Bogen), den du unten einfügst. So siehst du ihren aktuellen Stand. Jeder Spieler sieht und ändert ausschließlich seinen eigenen.',
      'Live-Übersicht aus Supabase. Noch nicht zugeordnete Charaktere zeigen ihre Ausgangswerte. Als Spielleiter kannst du alle Charakterbögen ansehen, aber nicht die Werte der Spieler verändern.'
    );
  };
  draw = function (soft) {
    const nav = document.getElementById('nav');
    const sheetRoot = document.getElementById('sheet');
    accountLine();
    if (!state.user) { nav.innerHTML = ''; sheetRoot.innerHTML = showLogin(); return; }
    if (!state.ready) { nav.innerHTML = ''; sheetRoot.innerHTML = '<div class="card">Charakterdaten werden geladen …</div>'; return; }
    if (state.role === 'guest' || (state.role === 'player' && !Object.keys(S).length)) {
      nav.innerHTML = ''; sheetRoot.innerHTML = roleChooser(); return;
    }
    original.draw(soft);
    if (state.role === 'gm') {
      for (const el of sheetRoot.querySelectorAll('button')) {
        if (el.textContent.trim() !== 'Kampfmodus' && el.textContent.trim() !== 'Bogen') el.disabled = true;
      }
      for (const el of sheetRoot.querySelectorAll('textarea,input,select')) el.disabled = true;
      for (const el of sheetRoot.querySelectorAll('[onclick].pip')) el.removeAttribute('onclick');
    }
  };
  function requirePlayer(id) {
    if (state.role === 'player' && id === mchar) return true;
    textNotice('Diese Ansicht ist schreibgeschützt.');
    return false;
  }
  const offlineHp = hp; hp = function (id, ...args) { if (requirePlayer(id)) return offlineHp(id, ...args); };
  const offlineAdj = adj; adj = function (id, ...args) { if (requirePlayer(id)) return offlineAdj(id, ...args); };
  const offlinePip = pip; pip = function (id, ...args) { if (requirePlayer(id)) return offlinePip(id, ...args); };
  const offlineDs = ds; ds = function (id, ...args) { if (requirePlayer(id)) return offlineDs(id, ...args); };
  const offlineInsp = insp; insp = function (id, ...args) { if (requirePlayer(id)) return offlineInsp(id, ...args); };
  const offlineRest = rest; rest = function (id, ...args) { if (requirePlayer(id)) return offlineRest(id, ...args); };
  const offlineCast = cast; cast = function (id, ...args) { if (requirePlayer(id)) return offlineCast(id, ...args); };
  const offlineSetv = setv; setv = function (element) { if (requirePlayer(cur)) return offlineSetv(element); };
  const offlineTog = tog; tog = function () { if (requirePlayer(cur)) return offlineTog(); };
  imp = function () {
    if (!requirePlayer(cur)) return;
    try {
      const value = String(document.getElementById('code')?.value || '');
      if (value.length > 600000) throw Error('Code zu lang');
      const sheet = dec(value);
      if (sheet?.char !== mchar) throw Error('Dieser Code gehört nicht zu deinem Charakter');
      S[mchar] = normalizeSheet(sheet,mchar);
      save(mchar); draw(); setSt('Sicherung importiert – Speicherung läuft');
    } catch (e) { textNotice('Sicherungscode ungültig oder nicht für diesen Charakter.'); }
  };
  save = function (id) {
    if (!requirePlayer(id)) return;
    dirty[id] = true;
    clearTimeout(timers[id]);
    timers[id] = setTimeout(async () => {
      if (!state.user || mchar !== id || state.role !== 'player') return;
      const payload = clone(S[id]);
      const { data, error } = await api.from('character_slots')
        .update({ sheet: payload }).eq('char_key', id).eq('owner_id', state.user.id)
        .select('char_key').maybeSingle();
      if (error || !data) {
        setSt(`Nicht gespeichert! ${safeMessage(error)}`);
      } else {
        delete dirty[id];
        setSt('Online gespeichert ✓');
      }
    }, 450);
  };
  async function loadRoleAndSheets(soft = false) {
    if (!state.user) return;
    if (refreshBusy) return;
    refreshBusy = true;
    try {
      const { data: gm, error: gmError } = await api.from('game_masters').select('user_id').eq('user_id', state.user.id).maybeSingle();
      if (gmError) throw gmError;
      const role = gm ? 'gm' : 'player';
      const { data: slots, error } = await api.from('character_slots').select('char_key,display_name,owner_id,sheet,updated_at').order('char_key');
      if (error) throw error;
      state.slots = slots || [];
      state.role = role;
      const old = S;
      S = {};
      if (role === 'gm') {
        for (const id of IDS) {
          const row = slots.find(x => x.char_key === id);
          S[id] = normalizeSheet(row?.sheet || {}, id);
        }
        isDM = true; mode = 'd'; mchar = ''; cur = cur !== 'all' && allowedKeys.has(cur) ? cur : 'all';
      } else {
        const ownRow = slots.find(x => x.owner_id === state.user.id && allowedKeys.has(x.char_key));
        if (ownRow) {
          const id = ownRow.char_key;
          S[id] = dirty[id] && old[id] ? old[id] : normalizeSheet(ownRow.sheet || {}, id);
          mchar = id; cur = id;
        } else { mchar = ''; cur = ''; }
        isDM = false; mode = 'p';
      }
      state.ready = true;
      setSt(role === 'gm' ? 'Spielleiter · live verbunden' : (mchar ? 'Spieler · live verbunden' : 'Angemeldet · Einladungscode eingeben'));
      draw(soft);
    } catch (e) {
      state.ready = false;
      setSt(`Cloud-Zugriff fehlgeschlagen: ${safeMessage(e)}. Bitte SQL-Einrichtung und Zugriffsregeln prüfen.`);
      const root = document.getElementById('sheet');
      root.innerHTML = '<div class="card">Die Datenbank ist noch nicht vollständig eingerichtet oder momentan nicht erreichbar. Bitte den Spielleiter informieren.</div>';
    } finally { refreshBusy = false; }
  }
  async function enterSession(session) {
    const seq = ++state.seq;
    if (state.channel) { await api.removeChannel(state.channel); state.channel = null; }
    state.user = null; state.ready = false; state.role = 'guest';
    S = {}; cur = 'all'; draw();
    if (!session) { setSt('Bitte über E-Mail anmelden.'); return; }
    const { data, error } = await api.auth.getUser();
    if (seq !== state.seq) return;
    if (error || !data?.user) { setSt('Anmeldung abgelaufen. Bitte erneut anmelden.'); return; }
    state.user = data.user;
    await loadRoleAndSheets();
    if (seq !== state.seq) return;
    state.channel = api.channel(`characters-${state.user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'character_slots' }, () => {
        loadRoleAndSheets(true);
      }).subscribe();
  }
  window.cloudLogin = async function () {
    const input = document.getElementById('loginEmail');
    const label = document.getElementById('loginFeedback');
    const email = String(input?.value || '').trim();
    if (!email) { textNotice('E-Mail-Adresse eingeben.'); return; }
    if (state.busy) return;
    state.busy = true;
    try {
      const { error } = await api.auth.signInWithOtp({ email, options: { emailRedirectTo: head() } });
      if (error) throw error;
      if (label) label.textContent = 'Anmeldelink angefordert. Bitte öffne die E-Mail auf diesem oder einem anderen Gerät.';
      setSt('Anmeldelink angefordert.');
    } catch (e) { textNotice(`Anmeldung fehlgeschlagen: ${safeMessage(e)}`); }
    finally { state.busy = false; }
  };
  window.cloudLogout = async function () {
    const { error } = await api.auth.signOut();
    if (error) textNotice(`Abmelden fehlgeschlagen: ${safeMessage(error)}`);
  };
  window.cloudClaim = async function (id) {
    if (!allowedKeys.has(id) || state.role !== 'player' || !state.user || mchar) return;
    const input = document.getElementById(`invite_${id}`);
    const code = String(input?.value || '').trim();
    if (!code) { textNotice('Bitte privaten Charaktercode eingeben.'); return; }
    if (state.busy) return;
    state.busy = true;
    try {
      const { error } = await api.rpc('claim_character', { p_character_key: id, p_code: code });
      if (error) throw error;
      input.value = '';
      await loadRoleAndSheets();
      textNotice('Charakter erfolgreich zugeordnet.');
    } catch (e) { textNotice(`Charakter konnte nicht übernommen werden: ${safeMessage(e)}`); }
    finally { state.busy = false; }
  };
  window.cloudActivateGM = async function () {
    if (state.role !== 'player' || !state.user || mchar) return;
    const input = document.getElementById('gmCode');
    const code = String(input?.value || '').trim();
    if (!code) { textNotice('Bitte Spielleiter-Code eingeben.'); return; }
    if (state.busy) return;
    state.busy = true;
    try {
      const { error } = await api.rpc('claim_gm', { p_code: code });
      if (error) throw error;
      input.value = '';
      await loadRoleAndSheets();
      textNotice('Spielleiteransicht aktiviert.');
    } catch (e) { textNotice(`Spielleiter-Freischaltung fehlgeschlagen: ${safeMessage(e)}`); }
    finally { state.busy = false; }
  };
  // We prefer a verified user (getUser) over trusting unverified local identity.
  api.auth.onAuthStateChange((event, session) => {
    // Token refresh is not a role change. Resetting during editing would lose unsaved fields.
    if (event === 'TOKEN_REFRESHED' && state.ready && state.user?.id === session?.user?.id) return;
    setTimeout(() => enterSession(session).catch(e => setSt(safeMessage(e))), 0);
  });
  // Supabase emits INITIAL_SESSION; use it as the single startup source.
  draw();
})();