/*
 * D&D Charakterbögen – no-email Supabase adapter.
 * Your random, private character code authenticates via restricted Postgres RPC.
 * Direct table access remains blocked by RLS / GRANTs; GM has read-only access.
 */
(() => {
  'use strict';
  const conf = window.DND_CLOUD_CONFIG || {};
  const url = String(conf.url || '').trim();
  const publishableKey = String(conf.publishableKey || '').trim();
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url) || !publishableKey || publishableKey.includes('HIER_EINFUEGEN')) {
    setSt('Online-Datenbank noch nicht konfiguriert.');
    return;
  }
  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    setSt('Supabase-Bibliothek konnte nicht geladen werden.');
    return;
  }
  const api = window.supabase.createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const storageKey = 'dnd_characters_cloud_v2';
  const allowed = new Set(IDS);
  const state = { role:'guest', code:'', char:'', busy:false, refreshing:false, polling:null, revision:{}, saving:{} };
  const original = { draw, overview, codeCard, hp, adj, pip, ds, insp, rest, cast, setv, tog };
  const safeMessage = e => {
    const msg = String(e?.message || 'Verbindung fehlgeschlagen.');
    if (/Ungültiger.*Code|Ungültiger Charaktercode|Ungültiger Spielleiter-Code/i.test(msg)) return 'Code ungültig. Bitte den privaten Code prüfen.';
    if (/Failed to fetch|network|timeout/i.test(msg)) return 'Keine Verbindung. Bitte Internetverbindung prüfen.';
    return msg.slice(0,200);
  };
  const note = msg => { setSt(msg); tst(msg); };
  function loadStored() {
    try {
      const x = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (x && (x.role === 'gm' || (x.role === 'player' && allowed.has(x.char)))
          && typeof x.code === 'string' && /^[A-Za-z0-9_-]{20,100}$/.test(x.code)) return x;
    } catch (_) { /* no storage permission */ }
    return null;
  }
  function remember() {
    try { localStorage.setItem(storageKey,JSON.stringify({role:state.role,char:state.char,code:state.code})); }
    catch (_) { setSt('Online verbunden. Automatischer Login auf diesem Gerät nicht möglich.'); }
  }
  function forget() { try { localStorage.removeItem(storageKey); } catch (_) {} }
  function normalizeSheet(raw,id) {
    const def = clone(D[id]);
    const s = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const out = {...def};
    for (const k of ['name','player','cls','race','bg','speed','langs','atk','sp','sl','rs','ft','gear','n','cb']) {
      if (typeof s[k] === 'string') out[k] = s[k].slice(0,20000);
    }
    for (const [k,[lo,hi]] of Object.entries({
      tmp:[0,9999],hdUsed:[0,100],insp:[0,1],sa:[0,5],initX:[-100,100],joat:[0,1],lvl:[1,20],ac:[0,100],hpMax:[1,9999],hp:[0,9999],hd:[1,20]})) {
      if (s[k] !== undefined && Number.isFinite(Number(s[k]))) out[k] = Math.max(lo,Math.min(hi,Math.trunc(Number(s[k]))));
    }
    for (const k of ['ab','sv','ds']) {
      if (Array.isArray(s[k])) out[k] = def[k].map((v,i) => {
        const n = Number(s[k][i]);
        return Number.isFinite(n) ? Math.max(k==='ab'?1:0,Math.min(k==='ab'?30:k==='sv'?1:3,Math.trunc(n))) : v;
      });
    }
    for (const k of ['slU','rsU']) {
      out[k] = {};
      if (s[k] && typeof s[k] === 'object' && !Array.isArray(s[k])) {
        for (const [i,v] of Object.entries(s[k])) {
          if (!/^(0|[1-9][0-9]?)$/.test(i)) continue;
          if (Number.isFinite(Number(v))) out[k][i] = Math.max(0,Math.min(99,Math.trunc(Number(v))));
        }
      }
    }
    if (s.sk && typeof s.sk === 'object' && !Array.isArray(s.sk)) {
      out.sk = {...def.sk};
      for (const [skill,v] of Object.entries(s.sk)) {
        if (SK.some(x=>x[0]===skill) && [0,1,2].includes(Number(v))) out.sk[skill]=Number(v);
      }
    }
    out.char=id;
    return out;
  }
  function showLogin() {
    return `<div class="card"><h3>Online-Charakterbögen</h3><h2>Mit deinem privaten Code anmelden</h2>
      <p>Wähle deinen Charakter und gib den <b>persönlichen Zugangscode</b> ein, den du vom Spielleiter bekommen hast. Keine E-Mail und kein Benutzerkonto erforderlich.</p>
      <form onsubmit="cloudLogin();return false">
        <div class="ed"><div><label for="loginCharacter">Meine Rolle</label><select id="loginCharacter" class="w" required>
          <option value="">Bitte auswählen</option>
          ${IDS.map(k=>`<option value="${k}">${esc(D[k].name)} · ${esc(D[k].cls)}</option>`).join('')}
          <option value="gm">Spielleiter (alle Charaktere ansehen)</option>
        </select></div>
        <div><label for="loginCode">Privater Zugangscode</label><input id="loginCode" class="w" type="password" required autocomplete="off" placeholder="Zugangscode"></div></div>
        <p class="note">Dein Zugang bleibt auf diesem Gerät gespeichert, bis du dich abmeldest. Teile deinen Code nicht weiter. Jeder mit diesem Code könnte deine Daten bearbeiten.</p>
        <button class="b" type="submit">Charakter öffnen</button>
      </form></div>`;
  }
  function accountLine() {
    const a = document.getElementById('account');
    if (!a) return;
    if (state.role==='guest') { a.style.display='none'; a.innerHTML=''; return; }
    a.style.display='block';
    a.innerHTML=`<div class="row" style="justify-content:space-between">
       <span class="note">${state.role==='gm'?'Spielleiter · alle Charaktere (nur lesen)':`${esc(D[state.char].name)} · automatisch online gespeichert`}</span>
       <a class="b" href="spieltisch.html" style="text-decoration:none">🎲 Live-Spieltisch</a> <button class="b" onclick="cloudLogout()">Abmelden</button></div>`;
  }
  overview = function () {
    return original.overview().replace(
      'Spieler schicken dir ihren Code (Button „Code erzeugen“ in ihrem Bogen), den du unten einfügst. So siehst du ihren aktuellen Stand. Jeder Spieler sieht und ändert ausschließlich seinen eigenen.',
      'Live-Gruppenübersicht (alle vier Sekunden aktualisiert). Als Spielleiter kannst du alle Charakterbögen lesen, aber keine Spielerwerte verändern.');
  };
  codeCard = function () {
    if (state.role!=='player') return '';
    return original.codeCard().replace(
      'Mit dem Code kann ein Stand auf ein anderes Gerät oder zum Spielleiter. Alles wird sonst nur in diesem Browser gespeichert.',
      'Dein Charakter wird automatisch in Supabase gespeichert. Dies ist nur eine zusätzliche Sicherung für dich.');
  };
  draw = function (soft=false) {
    const nav=document.getElementById('nav'),sheetRoot=document.getElementById('sheet');
    accountLine();
    if (state.role==='guest') { nav.innerHTML='';sheetRoot.innerHTML=showLogin();return; }
    original.draw(soft);
    if (state.role==='gm') {
      for (const b of sheetRoot.querySelectorAll('button')) {
        if (!['Kampfmodus','Bogen'].includes(b.textContent.trim())) b.disabled=true;
      }
      for (const e of sheetRoot.querySelectorAll('textarea,input,select')) e.disabled=true;
      for (const e of sheetRoot.querySelectorAll('[onclick].pip')) e.removeAttribute('onclick');
      // The overview table is navigable; database writes remain blocked even if the UI is bypassed.
    }
  };
  function requirePlayer(id) {
    if (state.role==='player' && id===state.char) return true;
    note('Diese Ansicht ist nur lesbar.'); return false;
  }
  for (const name of ['hp','adj','pip','ds','insp','rest','cast']) {
    const wrapped = (...args) => {
      if (requirePlayer(args[0])) return original[name](...args);
    };
    if (name==='hp') hp=wrapped;
    if (name==='adj') adj=wrapped;
    if (name==='pip') pip=wrapped;
    if (name==='ds') ds=wrapped;
    if (name==='insp') insp=wrapped;
    if (name==='rest') rest=wrapped;
    if (name==='cast') cast=wrapped;
  }
  setv = function (el) {if (requirePlayer(cur)) return original.setv(el);};
  tog = function () {if (requirePlayer(cur)) return original.tog();};
  imp = function () {
    if (!requirePlayer(cur)) return;
    try {
      const code=String(document.getElementById('code')?.value||'');
      if (code.length>600000) throw Error('Zu groß');
      const imported=dec(code);
      if (imported?.char!==state.char) throw Error('Falscher Charakter');
      S[state.char]=normalizeSheet(imported,state.char);
      save(state.char);draw();setSt('Sicherung geladen – wird online gespeichert');
    } catch (_) { note('Sicherungscode ungültig oder für einen anderen Charakter.'); }
  };
  async function loadData(silent=false) {
    if (state.role==='guest' || state.refreshing) return false;
    if (state.role==='player' && (dirty[state.char] || edit)) return false;
    state.refreshing=true;
    try {
      let data,error;
      if (state.role==='gm') ({data,error}=await api.rpc('read_party',{p_code:state.code}));
      else ({data,error}=await api.rpc('read_character',{p_character_key:state.char,p_code:state.code}));
      if (error) throw error;
      if (state.role==='gm') {
        if (!Array.isArray(data)) throw Error('Ungültige Gruppendaten');
        const all={};
        for (const id of IDS) {
          const row=data.find(x=>x.char_key===id);
          all[id]=normalizeSheet(row?.sheet||{},id);
        }
        S=all;mode='d';isDM=true;mchar='';if (cur!=='all'&&!allowed.has(cur)) cur='all';
      } else {
        if (data===null || typeof data!=='object') throw Error('Ungültige Charakterdaten');
        const id=state.char;
        S={[id]:normalizeSheet(data,id)};
        mchar=id;mode='p';isDM=false;cur=id;
      }
      if (!silent) setSt('Online verbunden ✓');
      draw(silent);
      return true;
    } catch (e) { if (!silent) setSt(`Online-Verbindung fehlgeschlagen: ${safeMessage(e)}`); return false; }
    finally { state.refreshing=false; }
  }
  let debounce={};
  save = function (id) {
    if (!requirePlayer(id)) return;
    dirty[id]=1;
    state.revision[id]=(state.revision[id]||0)+1;
    clearTimeout(debounce[id]);
    setSt('Speichern …');
    debounce[id]=setTimeout(()=>persist(id),450);
  };
  async function persist(id) {
    if (state.saving[id] || state.role!=='player' || state.char!==id) return;
    state.saving[id]=true;
    const revision=state.revision[id];
    const payload=clone(S[id]);
    try {
      const {error}=await api.rpc('write_character',{p_character_key:id,p_code:state.code,p_sheet:payload});
      if (error) throw error;
      if (revision===state.revision[id]) { delete dirty[id];setSt('Online gespeichert ✓'); }
      else {clearTimeout(debounce[id]);debounce[id]=setTimeout(()=>persist(id),150);}
    } catch (e) {
      setSt(`Nicht gespeichert! ${safeMessage(e)} · neuer Versuch in 10 Sekunden`);
      clearTimeout(debounce[id]);debounce[id]=setTimeout(()=>persist(id),10000);
    } finally { state.saving[id]=false; }
  }
  function startPolling() {
    if (state.polling) clearInterval(state.polling);
    state.polling=setInterval(() => {
      if (document.visibilityState!=='hidden') loadData(true);
    },4000);
  }
  async function loginInternal(role,id,code,isRestore=false) {
    if (state.busy) return;
    state.busy=true;
    setSt(isRestore?'Gespeicherten Zugang prüfen …':'Online-Zugang prüfen …');
    try {
      if ((role==='player' && !allowed.has(id)) || !/^[A-Za-z0-9_-]{20,100}$/.test(code)) throw Error('Ungültiger Charaktercode');
      let data,error;
      if (role==='gm') ({data,error}=await api.rpc('read_party',{p_code:code}));
      else ({data,error}=await api.rpc('read_character',{p_character_key:id,p_code:code}));
      if (error) throw error;
      if (role==='gm' && !Array.isArray(data)) throw Error('Unerwartete Antwort');
      if (role==='player' && (data===null || typeof data!=='object')) throw Error('Unerwartete Antwort');
      state.role=role;state.char=id;state.code=code;
      dirty={};edit=false;view='sheet';
      if (role==='gm') {
        S={};for(const key of IDS){const row=data.find(x=>x.char_key===key);S[key]=normalizeSheet(row?.sheet||{},key);}
        isDM=true;mode='d';mchar='';cur='all';
      } else {
        S={[id]:normalizeSheet(data,id)};
        isDM=false;mode='p';mchar=id;cur=id;
      }
      remember();startPolling();draw();setSt('Online verbunden ✓');
    } catch (e) {
      if (isRestore) forget();
      else note(`Anmeldung fehlgeschlagen: ${safeMessage(e)}`);
      state.role='guest';state.code='';state.char='';S={};mode='';draw();
    } finally {state.busy=false;}
  }
  window.cloudLogin = function () {
    const choice=String(document.getElementById('loginCharacter')?.value||'');
    const code=String(document.getElementById('loginCode')?.value||'').trim();
    if (!choice || !code) {note('Bitte Charakter und privaten Code eingeben.');return;}
    loginInternal(choice==='gm'?'gm':'player',choice==='gm'?'':choice,code);
  };
  window.cloudLogout = function () {
    if (state.polling) clearInterval(state.polling);
    for (const t of Object.values(debounce)) clearTimeout(t);
    forget();state.role='guest';state.code='';state.char='';S={};mode='';cur='all';dirty={};draw();
    setSt('Abgemeldet.');
  };
  document.addEventListener('visibilitychange',()=>{
    if (document.visibilityState==='visible') loadData(true);
  });
  // Never reuse legacy offline player choice or local player copies without explicit import.
  S={}; mode='';isDM=false;mchar='';cur='all';draw();
  const remembered=loadStored();
  if (remembered) loginInternal(remembered.role,remembered.char,remembered.code,true);
  else setSt('Privaten Zugangscode eingeben.');
})();