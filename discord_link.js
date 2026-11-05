// Discord Activity sign-in + cloud saves.
// When the game runs inside Discord, players are signed in with their Discord account and their
// progress (Monkey Money, Knowledge, achievements, unlocks, skins) is stored on the bot.
// Outside Discord nothing changes: saves stay in the browser (localStorage).
// Small built-in version of Discord's Embedded App SDK handshake (same protocol as @discord/embedded-app-sdk).
(() => {
  const CFG = Object.assign({ clientId: '', api: '/.proxy/api' }, window.DISCORD_CFG || {});
  const q = new URLSearchParams(location.search);
  const inDiscord = !!(q.get('frame_id') && q.get('instance_id') && CFG.clientId);
  const CLOUD = window.CLOUD = { active: false, user: null, token: null, inDiscord };
  if (!inDiscord) return;

  // ---- RPC with the Discord client (postMessage) ----
  const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, HELLO: 3 };
  const ORIGINS = new Set([location.origin, 'https://discord.com', 'https://discordapp.com', 'https://ptb.discord.com', 'https://ptb.discordapp.com', 'https://canary.discord.com', 'https://canary.discordapp.com', 'null']);
  const source = window.parent.opener || window.parent;
  const sourceOrigin = document.referrer || '*';
  const pending = new Map();
  let readyResolve; const ready = new Promise(r => readyResolve = r);
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random());
  window.addEventListener('message', ev => {
    if (!ORIGINS.has(ev.origin) || !Array.isArray(ev.data)) return;
    const [op, data] = ev.data;
    if (op !== OP.FRAME || !data) return;
    if (data.cmd === 'DISPATCH') { if (data.evt === 'READY') readyResolve(data.data); return; }
    const p = data.nonce && pending.get(data.nonce); if (!p) return;
    pending.delete(data.nonce);
    data.evt === 'ERROR' ? p.reject(data.data) : p.resolve(data.data);
  });
  function cmd(name, args) {
    const nonce = uid();
    source.postMessage([OP.FRAME, { cmd: name, args, nonce }], sourceOrigin);
    return new Promise((resolve, reject) => { pending.set(nonce, { resolve, reject }); setTimeout(() => { if (pending.delete(nonce)) reject(new Error(name + ' timed out')); }, 120000); });
  }
  source.postMessage([OP.HANDSHAKE, { v: 1, encoding: 'json', client_id: CFG.clientId, frame_id: q.get('frame_id'), sdk_version: '2.5.0' }], sourceOrigin);

  // ---- bot API ----
  const api = (p, opt = {}) => fetch(CFG.api + p, Object.assign({}, opt, {
    headers: Object.assign({ 'Content-Type': 'application/json' }, CLOUD.token ? { Authorization: 'Bearer ' + CLOUD.token } : {}, opt.headers || {}),
  })).then(async r => { if (!r.ok) { let d = ''; try { const j = await r.json(); d = [j.error, j.detail, j.desc].filter(Boolean).join(': '); } catch (e) { } throw new Error(p.split('?')[0] + ' ' + r.status + (d ? ' ' + d : '')); } return r.json(); });

  let pushTimer = null, pushing = false;
  function push() {
    if (!CLOUD.active) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(async () => {
      if (pushing) return push(); pushing = true;
      try { await api('/save', { method: 'POST', body: JSON.stringify({ profile: PROFILE }) }); }
      catch (e) { console.warn('cloud save failed', e); }
      pushing = false;
    }, 800);
  }
  CLOUD.push = push;
  function note(title, text) {
    const el = document.createElement('div'); el.className = 'achpop';
    el.innerHTML = `<div class="at">${title}</div><div class="ad"></div>`; el.querySelector('.ad').textContent = text;
    document.body.appendChild(el); setTimeout(() => el.classList.add('out'), 3800); setTimeout(() => el.remove(), 4400);
  }

  // every existing saveProfile() call now also saves to the cloud
  const localSave = window.saveProfile;
  window.saveProfile = function () { localSave(); push(); };
  window.addEventListener('pagehide', () => { if (CLOUD.active) { clearTimeout(pushTimer); try { fetch(CFG.api + '/save', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + CLOUD.token }, body: JSON.stringify({ profile: PROFILE }) }); } catch (e) { } } });

  // highscores go to the bot, under the player's Discord name
  HS.add = async function (rec) {
    const L = this.local(); L.push(rec); this.saveLocal(L);
    try { await api('/score', { method: 'POST', body: JSON.stringify({ rec }) }); } catch (e) { console.warn('score upload failed', e); }
  };
  const localTop = HS.top.bind(HS);
  HS.top = async function (cat) { try { return await api('/top?cat=' + encodeURIComponent(cat)); } catch (e) { return localTop(cat); } };
  const origAsk = window.askName;
  window.askName = function (rec) {
    if (!CLOUD.active) return origAsk(rec);
    rec.name = CLOUD.user.name; HS.add(rec).then(() => toastDom('Run saved to the server leaderboard!'));
  };

  // ---- sign in ----
  (async () => {
    let step = 'connecting to Discord';
    try {
      await ready;
      step = 'authorizing';
      const { code } = await cmd('AUTHORIZE', { client_id: CFG.clientId, response_type: 'code', state: '', prompt: 'none', scope: ['identify'] });
      step = 'logging in (token)';
      const { access_token } = await api('/token', { method: 'POST', body: JSON.stringify({ code }) });
      CLOUD.token = access_token;
      step = 'authenticating';
      await cmd('AUTHENTICATE', { access_token });
      step = 'loading your save';
      const res = await api('/save');
      CLOUD.user = res.user; CLOUD.active = true;
      if (res.profile) {
        // cloud copy wins; replace this browser's copy with it
        for (const k of Object.keys(PROFILE)) delete PROFILE[k];
        Object.assign(PROFILE, { mm: 0, owned: [], skin: {} }, res.profile);
        localSave();
      } else {
        push();   // first time on this account: upload whatever this browser already had
      }
      try { localStorage.setItem('bss_name', CLOUD.user.name); } catch (e) { }
      try { if (typeof buildMenu === 'function' && !G) buildMenu(); } catch (e) { console.warn('menu refresh failed', e); }
      try { if (window.NET) NET.connect(); } catch (e) { console.warn('co-op connect failed', e); }
      note('🎈 SIGNED IN', `${CLOUD.user.name} — progress saves to your Discord account`);
    } catch (e) {
      console.warn('Discord sign-in failed; saving locally only', e);
      const why = (e && (e.message || e.code)) || String(e);
      CLOUD.error = `Sign-in failed while ${step}: ${why}`;
      const el = document.createElement('div'); el.className = 'achpop'; el.style.cssText = 'cursor:pointer;max-width:520px;pointer-events:auto';
      el.innerHTML = '<div class="at">⚠ OFFLINE — click to close</div><div class="ad"></div>'; el.querySelector('.ad').textContent = CLOUD.error + '. Progress is only saved on this device.';
      el.onclick = () => el.remove(); document.body.appendChild(el);
    }
  })();
})();
