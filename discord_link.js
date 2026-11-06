// Discord Activity sign-in + cloud saves.
// When the game runs inside Discord, players are signed in with their Discord account and their
// progress (Monkey Money, Knowledge, achievements, unlocks, skins) is stored on the bot.
// Outside Discord nothing changes: saves stay in the browser (localStorage).
// Small built-in version of Discord's Embedded App SDK handshake (same protocol as @discord/embedded-app-sdk).
(() => {
  const CFG = Object.assign({ clientId: '', api: '/.proxy/api', webApi: '' }, window.DISCORD_CFG || {});
  const q = new URLSearchParams(location.search);
  const inDiscord = !!(q.get('frame_id') && q.get('instance_id') && CFG.clientId);
  const CLOUD = window.CLOUD = { active: false, user: null, token: null, inDiscord };
  // website (GitHub Pages): sign in with Discord's normal login page instead of the Activity handshake
  const web = !inDiscord && !!(CFG.clientId && CFG.webApi);
  if (!inDiscord && !web) return;
  const API = inDiscord ? CFG.api : CFG.webApi.replace(/\/$/, '');
  const WEB_REDIRECT = location.origin + '/';
  const TOK_KEY = 'bss_dtoken';

  // ---- RPC with the Discord client (postMessage) ----
  const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, HELLO: 3 };
  const ORIGINS = new Set([location.origin, 'https://discord.com', 'https://discordapp.com', 'https://ptb.discord.com', 'https://ptb.discordapp.com', 'https://canary.discord.com', 'https://canary.discordapp.com', 'null']);
  const source = inDiscord ? (window.parent.opener || window.parent) : null;
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
  if (inDiscord) source.postMessage([OP.HANDSHAKE, { v: 1, encoding: 'json', client_id: CFG.clientId, frame_id: q.get('frame_id'), sdk_version: '2.5.0' }], sourceOrigin);

  // ---- bot API ----
  const api = (p, opt = {}) => fetch(API + p, Object.assign({}, opt, {
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
  CLOUD.api = api;
  function note(title, text) {
    const el = document.createElement('div'); el.className = 'achpop';
    el.innerHTML = `<div class="at">${title}</div><div class="ad"></div>`; el.querySelector('.ad').textContent = text;
    document.body.appendChild(el); setTimeout(() => el.classList.add('out'), 3800); setTimeout(() => el.remove(), 4400);
  }

  // every existing saveProfile() call now also saves to the cloud
  const localSave = window.saveProfile;
  window.saveProfile = function () { localSave(); push(); };
  window.addEventListener('pagehide', () => { if (CLOUD.active) { clearTimeout(pushTimer); try { fetch(API + '/save', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + CLOUD.token }, body: JSON.stringify({ profile: PROFILE }) }); } catch (e) { } } });

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

  // ---- after a token is in hand (both ways of signing in) ----
  async function finishSignIn(firstLogin) {
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
    webButton();
    if (firstLogin) note('🎈 SIGNED IN', `${CLOUD.user.name} — progress saves to your Discord account`);
  }
  function offline(step, e) {
    console.warn('Discord sign-in failed; saving locally only', e);
    const why = (e && (e.message || e.code)) || String(e);
    CLOUD.error = `Sign-in failed while ${step}: ${why}`;
    const el = document.createElement('div'); el.className = 'achpop'; el.style.cssText = 'cursor:pointer;max-width:520px;pointer-events:auto';
    el.innerHTML = '<div class="at">⚠ OFFLINE — click to close</div><div class="ad"></div>'; el.querySelector('.ad').textContent = CLOUD.error + '. Progress is only saved on this device.';
    el.onclick = () => el.remove(); document.body.appendChild(el);
  }

  // ---- website: Sign in / Sign out button on the main menu ----
  function webButton() {
    if (!web) return;
    const b = document.getElementById('dsbtn'); if (!b) return;
    b.classList.remove('hidden');
    if (CLOUD.active) {
      b.innerHTML = 'Sign out <b></b>'; b.querySelector('b').textContent = CLOUD.user.name;
      b.title = 'Signed in with Discord: your progress and highscores save to your account';
      b.onclick = () => {
        try { localStorage.removeItem(TOK_KEY); } catch (e) { }
        location.reload();
      };
    } else {
      b.textContent = 'Sign in with Discord';
      b.title = 'Save your progress and highscores to your Discord account (same save as the Discord Activity)';
      b.onclick = () => {
        const state = uid();
        try { sessionStorage.setItem('bss_dstate', state); } catch (e) { }
        location.href = 'https://discord.com/oauth2/authorize?' + new URLSearchParams({ client_id: CFG.clientId, response_type: 'code', redirect_uri: WEB_REDIRECT, scope: 'identify', state, prompt: 'none' });
      };
    }
  }

  // ---- sign in ----
  if (web) (async () => {
    if (document.readyState === 'loading') await new Promise(r => document.addEventListener('DOMContentLoaded', r, { once: true }));
    webButton();
    let step = 'checking your login';
    try {
      const code = q.get('code'), state = q.get('state'), err = q.get('error');
      if (code || err) {
        // back from Discord's login page: tidy the address bar either way
        history.replaceState(null, '', location.pathname + location.hash);
        if (err) return;   // they pressed Cancel
        let want = null; try { want = sessionStorage.getItem('bss_dstate'); sessionStorage.removeItem('bss_dstate'); } catch (e) { }
        if (want && want === state) {
        step = 'logging in (token)';
        const t = await api('/token', { method: 'POST', body: JSON.stringify({ code, redirect_uri: WEB_REDIRECT }) });
        CLOUD.token = t.access_token;
        try { localStorage.setItem(TOK_KEY, JSON.stringify({ t: t.access_token, exp: Date.now() + Math.min(7 * 864e5, (t.expires_in || 604800) * 1000) - 36e5 })); } catch (e) { }
        step = 'loading your save';
        await finishSignIn(true);
        return;
        }
        // an old or reused login link: ignore it and carry on with any saved login
      }
      let saved = null; try { saved = JSON.parse(localStorage.getItem(TOK_KEY) || 'null'); } catch (e) { }
      if (!saved || !saved.t) return;
      if (!(saved.exp > Date.now())) { try { localStorage.removeItem(TOK_KEY); } catch (e) { } note('🎈 SIGNED OUT', 'Your Discord login expired. Press Sign in with Discord to keep saving to your account.'); return; }
      CLOUD.token = saved.t;
      step = 'loading your save';
      try { await finishSignIn(false); }
      catch (e) {
        if (/ 401/.test(e.message)) { CLOUD.token = null; try { localStorage.removeItem(TOK_KEY); } catch (x) { } note('🎈 SIGNED OUT', 'Your Discord login expired. Press Sign in with Discord to keep saving to your account.'); return; }
        throw e;
      }
    } catch (e) { CLOUD.token = null; offline(step, e); webButton(); }
  })();

  if (inDiscord) (async () => {
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
      await finishSignIn(true);
    } catch (e) { offline(step, e); }
  })();
})();
