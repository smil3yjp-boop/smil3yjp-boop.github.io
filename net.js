// Co-op for Discord Activities.
// Everyone in the same Activity instance joins one room (Cloudflare Durable Object relay).
// The host simulates the shared world (bloons, boss, drops); every player runs their OWN hero, towers,
// cards and chests locally, and sends the damage they deal to the host. Up to 4 players.
const NET = (() => {
  const BT = Object.keys(BLOONS);                       // bloon type <-> index
  const PK = ['soul', 'heart', 'chest', 'relic', 'banana'];
  const HZ = ['slime', 'magma', 'bossSlam', 'chargeLine'];
  const ENEMY_HZ = new Set(HZ);
  const PERSONAL_PK = new Set(['relic', 'banana']);
  const r2 = v => Math.round(v * 100) / 100, r1 = v => Math.round(v * 10) / 10;

  const N = {
    ws: null, me: null, hostId: null, roster: [], lobby: {}, ready: false,
    inRun: false, role: null, runIds: new Set(),
    peers: new Map(),                                  // id -> peer view (run members except me)
    world: null,                                       // last snapshot (guest)
    paused: [],                                        // names of players holding the world paused
    get on() { return this.inRun; },
    get host() { return this.inRun && this.role === 'host'; },
    get guest() { return this.inRun && this.role === 'guest'; },
    get amHost() { return !!this.me && this.hostId === this.me.id; },
    get others() { return this.roster.filter(p => !this.me || p.id !== this.me.id); },
  };
  let sendT = 0, worldT = 0, nid = 0, pid = 0, backoff = 1000;
  const dmgQ = [], owed = new Map(), toHost = [];

  // ------------------------------------------------------------------ transport
  function send(to, msg) { if (N.ws && N.ws.readyState === 1) { try { N.ws.send(to + '|' + JSON.stringify(msg)); } catch (e) { } } }
  N.send = send;
  function connect() {
    if (!window.CLOUD || !CLOUD.active || !CLOUD.token || N.ws) return;
    const q = new URLSearchParams(location.search), inst = q.get('instance_id');
    if (!inst) return;
    const base = (window.DISCORD_CFG && DISCORD_CFG.api) || '/.proxy/api';
    const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + base + '/room?instance=' + encodeURIComponent(inst) + '&token=' + encodeURIComponent(CLOUD.token);
    const ws = N.ws = new WebSocket(url);
    ws.onopen = () => { backoff = 1000; };
    ws.onmessage = ev => {
      const s = String(ev.data), bar = s.indexOf('|'); if (bar < 1) return;
      let m; try { m = JSON.parse(s.slice(bar + 1)); } catch (e) { return; }
      onMessage(s.slice(0, bar), m);
    };
    ws.onclose = ev => {
      N.ws = null; N.ready = false;
      if (ev.code === 4001) { N.full = true; refreshLobby(); return; }
      setTimeout(connect, backoff); backoff = Math.min(15000, backoff * 2);
    };
  }
  N.connect = connect;

  // ------------------------------------------------------------------ lobby
  function myLobby() {
    const ch = CHARS[menuSel.char], sk = selectedSkin(ch);
    return { t: 'hi', hero: ch.id, skin: sk ? sk.key : null, icon: sk ? sk.icon : HERO_ICON[ch.id], st: G ? (G.state === 'end' ? 'end' : 'run') : 'menu', name: N.me ? N.me.name : '' };
  }
  let lastHi = '';
  N.sayHi = (force) => { const m = JSON.stringify(myLobby()); if (!force && m === lastHi) return; lastHi = m; send('*', JSON.parse(m)); };
  let lastLobby = '';
  function hostLobby() { if (!N.amHost) return; const m = { t: 'lobby', chaos: menuSel.chaos, running: !!(G && N.inRun) }, k = JSON.stringify(m); if (k === lastLobby) return; lastLobby = k; send('*', m); }
  N.hostLobby = hostLobby;
  function refreshLobby() { if (typeof buildMenu === 'function' && (!G) && !$('menu').classList.contains('hidden')) buildMenu(); }

  function onRoster(m) {
    const prevHost = N.hostId;
    N.roster = m.players; N.hostId = m.host;
    for (const id of Object.keys(N.lobby)) if (!m.players.some(p => p.id === id)) delete N.lobby[id];
    // run members who left
    for (const id of [...N.peers.keys()]) if (!m.players.some(p => p.id === id)) { const pe = N.peers.get(id); N.peers.delete(id); N.runIds.delete(id); if (G && N.inRun) toast(`${pe.name} left the run`, '#cbbfa8'); }
    // host migration: the longest-connected player takes over the world
    if (N.inRun && prevHost && prevHost !== m.host && m.host === N.me.id && N.role === 'guest') promote();
    N.sayHi(true); lastLobby = ''; hostLobby(); refreshLobby();
  }

  function onMessage(from, m) {
    if (from === '#') {
      if (m.t === 'welcome') { N.me = { id: m.id, name: m.name }; N.ready = true; }
      else if (m.t === 'roster') onRoster(m);
      else if (m.t === 'full') { N.full = true; refreshLobby(); }
      return;
    }
    switch (m.t) {
      case 'hi': N.lobby[from] = Object.assign(N.lobby[from] || {}, m); refreshLobby(); break;
      case 'lobby': if (from === N.hostId) { N.hostChaos = m.chaos; N.hostRunning = m.running; if (!G) { menuSel.chaos = m.chaos; } refreshLobby(); } break;
      case 'start': if (from === N.hostId) onStart(m); break;
      case 'p': onPeer(from, m); break;
      case 'w': if (N.guest && from === N.hostId) applyWorld(m); break;
      case 'e': if (N.guest && from === N.hostId) onEvents(m); break;
      case 'mech': if (N.guest && from === N.hostId) onMech(m); break;
      case 'bk': if (N.guest && from === N.hostId) onBossKill(m); break;
      case 'cont': if (N.guest && from === N.hostId) continueRun(m.map); break;
      case 'end': if (N.inRun && from === N.hostId && G) { endRun(m.win, m.quit); } break;
      case 'd': if (N.host && N.runIds.has(from)) applyDamage(from, m.d); break;
      case 'xp': if (N.host && N.runIds.has(from)) gainXp(m.v / Math.max(0.01, G.stats.xp)); break;
      case 'portal': if (N.host && N.runIds.has(from)) usePortal(m.k); break;
    }
  }

  // ------------------------------------------------------------------ run start / end
  N.canStart = () => N.ready && N.amHost && N.others.length > 0;
  N.lobbyPlayers = () => N.roster.filter(p => p.id === (N.me && N.me.id) || N.lobby[p.id]);
  // host pressed BEGIN RUN
  N.startRun = map => {
    const ids = N.roster.filter(p => p.id === N.me.id || (N.lobby[p.id] && N.lobby[p.id].st !== 'run')).map(p => p.id);
    N.inRun = ids.length > 1; N.role = N.inRun ? 'host' : null;
    N.runIds = new Set(ids.filter(id => id !== N.me.id)); N.peers.clear();
    for (const id of N.runIds) N.peers.set(id, newPeer(id));
    if (N.inRun) send('*', { t: 'start', map, chaos: menuSel.chaos, ids });
    return N.inRun;
  };
  function onStart(m) {
    if (!m.ids.includes(N.me.id)) { N.hostRunning = true; refreshLobby(); return; }
    if (G && G.state !== 'end') return;              // already in a run (shouldn't happen)
    if (G) { show('end', false); G = null; R3.resetRun(); }
    show('hsname', false);
    menuSel.chaos = m.chaos;
    N.inRun = true; N.role = 'guest'; N.world = null; N.paused = [];
    N.runIds = new Set(m.ids.filter(id => id !== N.me.id)); N.peers.clear();
    for (const id of N.runIds) N.peers.set(id, newPeer(id));
    stopMenuMusic(); newGame({ map: m.map });
  }
  N.leaveRun = () => { N.inRun = false; N.role = null; N.peers.clear(); N.runIds.clear(); N.world = null; N.paused = []; dmgQ.length = 0; owed.clear(); netBloons.clear(); lastLobby = ''; setTimeout(() => { N.sayHi(true); hostLobby(); }, 50); };
  function usePortal(k) {
    if (!G || !G.portals) return;
    if (k === 'continue') N.hostContinue(); else { G.portals = null; send('*', { t: 'end', win: true, quit: true }); endRun(true, true); }
  }
  N.usePortal = usePortal;
  N.hostContinue = () => {
    let idx = G.mapIdx; if (MAPS.length > 1) while (idx === G.mapIdx) idx = Math.floor(Math.random() * MAPS.length);
    send('*', { t: 'cont', map: idx }); continueRun(idx);
  };
  N.allDownCheck = () => {
    if (!N.host || !G || G.state === 'end') return;
    if (!G.player.down) return;
    for (const pe of N.peers.values()) if (!pe.player.down && pe.st !== 'end') return;
    send('*', { t: 'end', win: false, quit: false }); endRun(false);
  };

  // ------------------------------------------------------------------ peers (other players' heroes)
  function newPeer(id) {
    const r = N.roster.find(p => p.id === id);
    return { id, name: r ? r.name : 'Monkey', key: null, skin: null, st: 'run', player: { x: 0, y: 0, vx: 0, vy: 0, r: 0.6, faceA: Math.PI / 2, dashT: 0, inv: 0, hurtT: -1, buffT: 0, down: false, rev: 0, hp: 1, mhp: 1 },
      tx: 0, ty: 0, comps: new Map(), summons: new Map(), projs: [], fx: [], gold: 0, cc: 100, xm: 1, mg: 3, seen: 0 };
  }
  function onPeer(from, m) {
    if (!N.inRun || !N.runIds.has(from)) return;
    if (m.d && N.host) applyDamage(from, m.d);
    const pe = N.peers.get(from) || (N.peers.set(from, newPeer(from)), N.peers.get(from));
    const P = pe.player, first = !pe.seen;
    pe.seen = performance.now();
    pe.tx = m.x; pe.ty = m.y; if (first || Math.hypot(P.x - m.x, P.y - m.y) > 8) { P.x = m.x; P.y = m.y; }
    P.vx = m.vx; P.vy = m.vy; P.faceA = m.fa; P.dashT = m.dt; P.inv = m.iv; P.hurtT = m.ht; P.buffT = m.bt; P.down = !!m.dn; P.rev = m.rv || 0; P.hp = m.hp; P.mhp = m.mh;
    pe.st = m.st; pe.gold = m.g; pe.cc = m.cc; pe.xm = m.xm; pe.mg = m.mg;
    if (m.sk && m.sk !== pe.skin) { pe.skin = m.sk; if (!R3.hasRig(m.sk)) R3.loadSkin(m.sk).catch(() => { }); }
    pe.key = m.sk && R3.hasRig(m.sk) ? m.sk : m.k;
    // towers
    const seen = new Set();
    for (const t of m.tw || []) {
      const [id, lv, p3, p5, x, y, fired, para] = t; seen.add(id);
      let c = pe.comps.get(id);
      if (!c) { c = { sk: { id, lv, path3: p3 || null, path5: p5 || null, fired, state: {} }, x, y }; pe.comps.set(id, c); if (R3.loadTower) R3.loadTower(id); }
      Object.assign(c.sk, { lv, path3: p3 || null, path5: p5 || null, fired, paragon: !!para }); c.tx = x; c.ty = y;
    }
    for (const id of [...pe.comps.keys()]) if (!seen.has(id)) pe.comps.delete(id);
    // summons (stable objects so the renderer keeps their models)
    const sseen = new Set();
    (m.sm || []).forEach((s, i) => {
      const [kind, x, y, face, lv, sp, anim, sid, p3, p5, dive, bird] = s, key = kind + i; sseen.add(key);
      let o = pe.summons.get(key);
      if (!o) { o = { kind, x, y, sp, a: 0, life: 99, t: 0, sk: { id: sid, lv, path3: p3 || null, path5: p5 || null, state: {} }, net: true }; pe.summons.set(key, o); if (sid && R3.loadTower) R3.loadTower(sid); }
      o.tx = x; o.ty = y; o.face = face; o.sp = sp; o.dive = dive; o.bird = !!bird; o.sk.lv = lv; o.sk.path3 = p3 || null; o.sk.path5 = p5 || null; if (anim) o.anim = anim;
    });
    for (const k of [...pe.summons.keys()]) if (!sseen.has(k)) pe.summons.delete(k);
    pe.projs = (m.pr || []).map(a => ({ spr: a[0] || undefined, kind: a[1], x: a[2], y: a[3], vx: a[4], vy: a[5], rot: a[6], r: a[7], t: 0, net: true }));
    for (const f of m.fx || []) pe.fx.push({ kind: f[0], x: f[1], y: f[2], r: f[3], color: f[4] || undefined, life: f[5], x2: f[6], y2: f[7], t: 0, net: true });
    if (pe.fx.length > 80) pe.fx.splice(0, pe.fx.length - 80);
  }
  // per-frame: smooth peers, age their effects
  function stepPeers(dt) {
    for (const pe of N.peers.values()) {
      const P = pe.player, k = Math.min(1, dt * 12);
      P.x += (pe.tx - P.x) * k; P.y += (pe.ty - P.y) * k;
      for (const c of pe.comps.values()) { c.x = c.x === undefined ? c.tx : c.x + (c.tx - c.x) * k; c.y = c.y === undefined ? c.ty : c.y + (c.ty - c.y) * k; }
      for (const o of pe.summons.values()) { o.x += (o.tx - o.x) * k; o.y += (o.ty - o.y) * k; }
      for (const pr of pe.projs) { pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.t += dt; }
      for (const f of pe.fx) f.t += dt;
      pe.fx = pe.fx.filter(f => f.t < f.life);
    }
  }
  // what the renderer needs from peers
  N.renderPeers = () => [...N.peers.values()].filter(pe => pe.key && pe.st !== 'end');
  N.extraProjs = () => { const a = []; for (const pe of N.peers.values()) a.push(...pe.projs); return a; };
  N.extraSummons = () => { const a = []; for (const pe of N.peers.values()) a.push(...pe.summons.values()); return a; };
  N.extraFx = () => { const a = []; for (const pe of N.peers.values()) a.push(...pe.fx); return a; };
  // living teammates (for revives and bloon targeting)
  N.alivePeers = () => [...N.peers.values()].filter(pe => pe.seen && !pe.player.down && pe.st !== 'end').map(pe => pe.player);

  function myPeerPacket() {
    const p = G.player;
    const tw = G.skills.filter(k => !k.hero && G.towerPos[k.id]).map(k => [k.id, k.lv, k.path3 || 0, k.path5 || 0, r2(G.towerPos[k.id].x), r2(G.towerPos[k.id].y), k.fired || 0, k.paragon ? 1 : 0]);
    const sm = G.summons.map(s => [s.kind, r2(s.x), r2(s.y), s.face !== undefined ? r2(s.face) : null, s.sk ? s.sk.lv : 1, s.sp || 0, s.anim || 0, s.sk && !s.sk.hero ? s.sk.id : 0, s.sk ? s.sk.path3 || 0 : 0, s.sk ? s.sk.path5 || 0 : 0, r2(s.dive || 0), s.bird ? 1 : 0]);
    const pr = []; for (let i = G.projs.length - 1; i >= 0 && pr.length < 70; i--) { const q = G.projs[i]; pr.push([q.spr || 0, q.kind, r2(q.x), r2(q.y), r1(q.vx), r1(q.vy), r2(q.rot || 0), r2(q.r)]); }
    const fx = []; for (const e of G.effects) { if (e.net || e.sent || e.kind === 'pop' || e.kind === 'coinpop' || e.kind === 'ghost' || fx.length >= 25) continue; e.sent = true; fx.push([e.kind, r2(e.x), r2(e.y), r2(e.r || 1), e.color || 0, r2(e.life - e.t), e.x2 !== undefined ? r2(e.x2) : null, e.y2 !== undefined ? r2(e.y2) : null]); }
    const sk = selectedSkin(G.ch);
    return { t: 'p', x: r2(p.x), y: r2(p.y), vx: r1(p.vx), vy: r1(p.vy), fa: r2(p.faceA ?? Math.PI / 2), dt: r2(p.dashT), iv: r2(p.inv), ht: r2(p.hurtT), bt: p.buffT > 0 ? 1 : 0, dn: p.down ? 1 : 0, rv: r2(p.rev || 0),
      hp: Math.round(p.hp), mh: Math.round(G.stats.maxhp), k: G.ch.model, sk: sk ? sk.key : null, st: G.state, g: Math.floor(G.gold), cc: chestCost(), xm: r2(G.stats.xp), mg: r2(G.stats.magnet), tw, sm, pr, fx };
  }

  // ------------------------------------------------------------------ host: world snapshot
  N.idBloon = b => { if (b.nid === undefined) b.nid = ++nid; };
  function worldPacket() {
    const b = [];
    for (const o of G.bloons) {
      if (o.dead) continue;
      if (o.nid === undefined) o.nid = ++nid;
      const f = (o.camo ? 1 : 0) | (o.regrow ? 2 : 0) | (o.fort ? 4 : 0) | (o.frozenT > 0 ? 8 : 0) | (o.slowT > 0 ? 16 : 0) | (o.stunT > 0 ? 32 : 0) | (o.phased ? 64 : 0) | (o.elite ? 128 : 0) | (o.minion ? 256 : 0) | (o.slime ? 512 : 0) | (o.wind ? 1024 : 0) | (o.phase ? 2048 : 0) | (o.burnT > 0 ? 4096 : 0);
      b.push(o.nid, BT.indexOf(o.type), r1(o.x), r1(o.y), r1(o.hp), r1(o.maxhp), f, o.hop ? r2(o.hop) : 0);
    }
    const B = G.boss && !G.boss.dead ? G.boss : null;
    const pk = [];
    for (const q of G.pickups) {
      if (PERSONAL_PK.has(q.kind) || q.dead) continue;
      if (q.pid === undefined) q.pid = ++pid;
      pk.push(q.pid, PK.indexOf(q.kind), r2(q.x), r2(q.y), q.free ? 1 : 0, q.owner || 0, q.v ? r1(q.v) : 0);
    }
    return {
      t: 'w', tt: r1(G.t), lv: G.level, xp: r1(G.xp), xn: G.xpNext, pops: G.pops, goal: G.goal, gs: G.goalStart, loop: G.loop, map: G.mapIdx, bk: G.bossKills, kills: G.kills,
      bl: r2(G.blindT), bm: G.blindMax || 0, ts: r2(G.towerStunT), es: G.elitesSpawned, bd: G.bossDone ? 1 : 0, gr: r1(G.grace), pz: pausedBy(),
      po: G.portals ? G.portals.map(q => [q.kind, r2(q.x), r2(q.y), r2(q.t)]) : null,
      bo: B ? [B.def.id, r2(B.x), r2(B.y), r1(B.hp), r1(B.maxhp), r2(B.r), (B.shield || B.shieldT > 0) ? 1 : 0, B.phase, B.skulls.length, r2(G.bossIntro || 0), B.charge ? [r2(B.charge.a), r2(B.charge.t), B.charge.tele, B.charge.dur] : 0, r2(B.drainFx || 0), B.anim || 0, r2(B.spd), r2(B.atkT), r2(B.mechT ?? 8), B.blimpSkull, B.dashAtSpawn || 0] : null,
      b, e: G.eproj.map(q => [r2(q.x), r2(q.y), r1(q.vx), r1(q.vy), r2(q.r), r1(q.dmg), r2(q.life)]),
      h: G.hazards.filter(h => ENEMY_HZ.has(h.kind)).map(h => [HZ.indexOf(h.kind), r2(h.x), r2(h.y), r2(h.r || 0), r2(h.t), r2(h.life), r1(h.dmg || 0), r2(h.a || 0), r2(h.len || 0), r2(h.w || 0)]),
      k: pk,
    };
  }
  function pausedBy() {
    const out = [];
    if (G.state !== 'play') out.push(N.me.name);
    for (const pe of N.peers.values()) if (pe.seen && (pe.st === 'levelup' || pe.st === 'pause' || pe.st === 'loading')) out.push(pe.name);
    return out;
  }
  // host: is someone holding the world (picking cards, paused, loading)?
  N.worldHeld = () => { if (!N.host) return false; for (const pe of N.peers.values()) if (pe.seen && (pe.st === 'levelup' || pe.st === 'pause' || pe.st === 'loading')) return true; return false; };

  // host: apply damage a guest dealt
  function applyDamage(from, list) {
    if (!G || G.state === 'end') return;
    const byId = new Map(); for (const b of G.bloons) if (!b.dead && b.nid !== undefined) byId.set(b.nid, b);
    for (const [id, d, src, slow, frz, stn, bT, bD, hT, hD, kx, ky] of list) {
      const b = id === -1 ? (G.boss && !G.boss.dead ? G.boss : null) : byId.get(id);
      if (!b || b.dead) continue;
      if (slow) b.slowT = Math.max(b.slowT || 0, slow);
      if (frz) b.frozenT = Math.max(b.frozenT || 0, frz);
      if (stn) b.stunT = Math.max(b.stunT || 0, stn);
      if (bT) { b.burnT = Math.max(b.burnT || 0, bT); b.burnD = Math.max(b.burnD || 0, bD); b.burnSrc = src; b.burnOwner = from; }
      if (hT) { b.hexT = Math.max(b.hexT || 0, hT); b.hexD = Math.max(b.hexD || 0, hD); b.hexOwner = from; }
      if (kx || ky) { b.kx = (b.kx || 0) + kx; b.ky = (b.ky || 0) + ky; }
      if (d > 0) {
        b.lastOwner = from; b.lastSrc = src;
        b.hp -= d; b.hitT = 0.08;
        if (b.hp <= 0) b.isBoss ? killBoss(b) : popBloon(b, -b.hp);
      }
    }
  }
  // host: a pop that a guest earned -> their gold + achievements
  N.credit = (to, src, b, base) => {
    let o = owed.get(to); if (!o) owed.set(to, o = { g: [] });
    o.g.push([src || 'hero', BT.indexOf(b.type), r1(base), r2(b.x), r2(b.y), b.def.golden ? 1 : 0]);
  };
  function owe(to, key, v) { let o = owed.get(to); if (!o) owed.set(to, o = { g: [] }); (o[key] || (o[key] = [])).push(v); }
  N.hurtPeer = (to, dmg) => owe(to, 'hurt', r1(dmg));
  N.broadcastMech = id => send('*', { t: 'mech', id });
  N.broadcastBossKill = b => send('*', { t: 'bk', id: b.def.id, x: r2(b.x), y: r2(b.y) });

  // host: pickups for teammates (souls -> shared XP, hearts, chests, all decided here)
  function hostPickups(dt) {
    for (const pe of N.peers.values()) {
      const P = pe.player; if (!pe.seen || P.down || pe.st === 'end') continue;
      for (const pk of G.pickups) {
        if (pk.dead || PERSONAL_PK.has(pk.kind)) continue;
        const dx = P.x - pk.x, dy = P.y - pk.y, d = Math.hypot(dx, dy);
        const range = pk.kind === 'soul' ? pe.mg : pk.kind === 'chest' ? 0 : 1.4;
        if (d < range) { const k = Math.min(1, dt * 10); pk.x += dx * k; pk.y += dy * k; }
        if (d >= (pk.kind === 'chest' ? 1.4 : 0.7)) continue;
        if (pk.kind === 'soul') { pk.dead = true; gainXp(pk.v * (pe.xm || 1) / Math.max(0.01, G.stats.xp)); }
        else if (pk.kind === 'heart') { pk.dead = true; owe(pe.id, 'heal', 0.3); }
        else if (pk.kind === 'chest') {
          if (pk.owner && pk.owner !== pe.id) continue;
          if (pk.free || pe.gold >= pe.cc) { pk.dead = true; owe(pe.id, 'chest', [pk.free ? 1 : 0, r2(pk.x), r2(pk.y)]); pe.gold -= pk.free ? 0 : pe.cc; }
        }
      }
    }
  }

  // ------------------------------------------------------------------ guest: apply host world
  const netBloons = new Map();
  function makeBloon(id, type) {
    const def = BLOONS[type];
    return { nid: id, net: true, type, def, x: 0, y: 0, r: def.r, hp: 1, maxhp: 1, jit: 1, anc: [], quiet: 0, slowT: 0, frozenT: 0, stunT: 0, burnT: 0, burnD: 0, hitT: 0, dead: false,
      wob: Math.random() * 6.28, elite: false, kx: 0, ky: 0, spd: bloonSpd(def), pend: [], base: null };
  }
  function popFx(b) {
    G.effects.push({ kind: 'pop', x: b.x, y: b.y, r: b.r, t: 0, life: 0.16, color: b.def.color, net: true });
    if (b.def.moab) { G.effects.push({ kind: 'expl', x: b.x, y: b.y, r: b.r * 1.4, t: 0, life: 0.7, net: true }); shake(0.35); play(b.type === 'zomg' || b.type === 'bfb' ? 'ZomgDestroyed01' : 'MoabDestroyed0*', { vol: 0.9, gap: 0.1, key: 'moabdie' }); }
    else if (b.type === 'ceramic') play('CeramicDestroyed0*', { vol: 0.45, gap: 0.05 });
    else sfxPop(false);
  }
  function pendSum(b, now) { let s = 0; b.pend = b.pend.filter(q => now - q[0] < 400); for (const q of b.pend) s += q[1]; return s; }
  function applyWorld(w) {
    if (!G || G.state === 'loading') return;
    if (w.map !== G.mapIdx) return;                     // portal transition in progress
    const now = performance.now();
    N.world = w; N.paused = w.pz || [];
    // shared progress
    if (w.lv > G.level) {
      const n = w.lv - G.level; G.pendingLevels += n; G.level = w.lv;
      play('TowerUpgrade', { vol: 0.7, gap: 0.3 }); R3.playerAnim('upgrade'); if (G.level % 3 === 0) voice('Upgrade');
      if (G.state === 'play') openLevelUp();
    }
    G.xp = w.xp; G.xpNext = w.xn; G.pops = w.pops; G.goal = w.goal; G.goalStart = w.gs; G.loop = w.loop; G.bossKills = w.bk; G.kills = w.kills;
    G.blindT = w.bl; G.blindMax = w.bm; G.towerStunT = w.ts; G.elitesSpawned = w.es; G.bossDone = !!w.bd; G.grace = w.gr; G.netT = w.tt;
    // bloons
    const seen = new Set(), B = w.b;
    for (let i = 0; i < B.length; i += 8) {
      const id = B[i], type = BT[B[i + 1]]; if (!type) continue;
      seen.add(id);
      let b = netBloons.get(id);
      if (!b) { b = makeBloon(id, type); b.x = B[i + 2]; b.y = B[i + 3]; netBloons.set(id, b); }
      if (b.type !== type) {                              // lost a layer
        if (!b.dead) popFx(b);
        const def = BLOONS[type]; b.type = type; b.def = def; b.r = def.r; b.spd = bloonSpd(def); b.pend = []; b.dead = false;
      }
      b.tx = B[i + 2]; b.ty = B[i + 3]; b.maxhp = B[i + 5];
      const hp = B[i + 4] - pendSum(b, now);
      b.hp = hp; if (hp > 0 && b.dead && !b.pend.length) b.dead = false;
      const f = B[i + 6];
      b.camo = !!(f & 1); b.regrow = !!(f & 2); b.fort = !!(f & 4); b.phased = !!(f & 64); b.elite = !!(f & 128); b.minion = !!(f & 256); b.slime = !!(f & 512); b.wind = !!(f & 1024); b.phase = !!(f & 2048);
      // status baselines (local skills raise these; the difference is sent to the host)
      b.frozenT = Math.max(b.frozenT, f & 8 ? 0.2 : 0); b.slowT = Math.max(b.slowT, f & 16 ? 0.2 : 0); b.stunT = Math.max(b.stunT, f & 32 ? 0.2 : 0);
      if (!(f & 8)) b.frozenT = Math.min(b.frozenT, 0.2); if (!(f & 16)) b.slowT = Math.min(b.slowT, 0.2); if (!(f & 32)) b.stunT = Math.min(b.stunT, 0.2);
      b.burnT = f & 4096 ? Math.max(b.burnT, 0.2) : Math.min(b.burnT, 0.2);
      b.hop = B[i + 7];
      b.base = { slowT: b.slowT, frozenT: b.frozenT, stunT: b.stunT, burnT: b.burnT, hexT: b.hexT || 0 };
      if (b.def.golden) { b.x = b.tx; b.y = b.ty; }
    }
    for (const [id, b] of netBloons) if (!seen.has(id)) { if (!b.dead) popFx(b); b.dead = true; netBloons.delete(id); }
    G.bloons = [...netBloons.values()];
    // boss
    if (w.bo) {
      const [id, x, y, hp, mhp, r, sh, phase, sk, intro, ch, drain, anim, spd, atkT, mechT, blimpSkull, das] = w.bo;
      let b = G.boss;
      if (!b || b.def.id !== id || b.dead) {
        const def = BOSSES.find(d => d.id === id);
        b = G.boss = { isBoss: true, net: true, nid: -1, def, x, y, r, hp, maxhp: mhp, spd, dead: false, hitT: 0, slowT: 0, frozenT: 0, stunT: 0, burnT: 0, burnD: 0, atkT, phase, wob: 0, kx: 0, ky: 0, shield: false,
          skulls: [0.75, 0.5, 0.25].slice(3 - sk), blimpSkull, dashAtSpawn: G.dashesUsed || 0, pend: [] };
        G.bossIntro = intro; play(BOSS_SFX[id][0], { vol: 1 }); shake(0.6);
      }
      b.tx = x; b.ty = y; b.r = r; b.maxhp = mhp; b.hp = hp - pendSum(b, now); b.shieldT = sh ? 0.2 : 0; b.phase = phase; b.spd = spd; b.atkT = atkT; b.mechT = mechT;
      while (b.skulls.length > sk) b.skulls.shift();
      b.charge = ch ? { a: ch[0], t: ch[1], tele: ch[2], dur: ch[3] } : null; b.drainFx = drain; if (anim) b.anim = anim;
      b.base = { slowT: b.slowT, frozenT: b.frozenT, stunT: b.stunT, burnT: b.burnT, hexT: b.hexT || 0 };
    } else if (G.boss && !G.boss.dead) { G.boss.dead = true; setTimeout(() => { if (G && G.boss && G.boss.dead) G.boss = null; }, 2500); }
    // enemy shots, hazards, world pickups, portals
    G.eproj = w.e.map(a => ({ x: a[0], y: a[1], vx: a[2], vy: a[3], r: a[4], dmg: a[5], life: a[6], net: true }));
    G.netHaz = w.h.map(a => ({ kind: HZ[a[0]], x: a[1], y: a[2], r: a[3], t: a[4], life: a[5], dmg: a[6], a: a[7], len: a[8], w: a[9], net: true }));
    const mine = G.pickups.filter(q => !q.net), old = new Map(G.pickups.filter(q => q.net).map(q => [q.pid, q]));
    const K = w.k, pk = [];
    for (let i = 0; i < K.length; i += 7) {
      const id = K[i]; let q = old.get(id);
      if (!q) q = { pid: id, net: true, kind: PK[K[i + 1]], x: K[i + 2], y: K[i + 3], t: 0 };
      q.tx = K[i + 2]; q.ty = K[i + 3]; q.free = !!K[i + 4]; q.owner = K[i + 5] || null; q.v = K[i + 6];
      if (q.owner && q.owner !== N.me.id) continue;            // someone else's boss chest
      pk.push(q);
    }
    G.pickups = mine.concat(pk);
    G.portals = w.po ? w.po.map(([kind, x, y, t]) => ({ kind, x, y, t, near: G.portals && G.portals.find(q => q.kind === kind && q.near) ? true : false })) : null;
  }
  N.resetWorld = () => { netBloons.clear(); N.world = null; };
  // guest: per-frame smoothing of the host world + local hits against it
  N.guestWorldStep = (dt) => {
    const p = G.player, k = Math.min(1, dt * 12);
    for (const b of G.bloons) {
      if (b.tx !== undefined && !b.def.golden) { b.x += (b.tx - b.x) * k; b.y += (b.ty - b.y) * k; }
      b.wob += dt * 4; b.hitT -= dt;
      if (b.dead || p.down) continue;
      if (Math.hypot(p.x - b.x, p.y - b.y) < b.r + p.r) hurtPlayer(b.def.dmg * G.chaos.dmg);
    }
    const B = G.boss;
    if (B && !B.dead) {
      if (B.tx !== undefined) { B.x += (B.tx - B.x) * k; B.y += (B.ty - B.y) * k; }
      B.hitT -= dt; B.wob += dt * 2; if (G.bossIntro > 0) G.bossIntro -= dt;
      if (!p.down && Math.hypot(p.x - B.x, p.y - B.y) < B.r + p.r) hurtPlayer(30 * G.chaos.dmg);
    }
    for (const e of G.eproj) {
      e.x += e.vx * dt; e.y += e.vy * dt; e.life -= dt;
      if (!p.down && Math.hypot(e.x - p.x, e.y - p.y) < e.r + p.r * 0.8) { hurtPlayer(e.dmg); e.life = 0; }
    }
    G.eproj = G.eproj.filter(e => e.life > 0);
    for (const h of G.netHaz || []) {
      h.t += dt;
      if (p.down) continue;
      if (h.kind === 'slime') { if (Math.hypot(p.x - h.x, p.y - h.y) < h.r) p.slowT = 0.3; }
      else if (h.kind === 'magma') { h.tick = (h.tick || 0) - dt; if (h.tick <= 0 && Math.hypot(p.x - h.x, p.y - h.y) < h.r + p.r * 0.5) { h.tick = 0.5; hurtPlayer(8 * G.chaos.dmg); } }
      else if (h.kind === 'bossSlam' && h.t >= h.life && !h.done) { h.done = true; G.effects.push({ kind: 'boom', x: h.x, y: h.y, r: h.r, t: 0, life: 0.4, color: '#ff3030', net: true }); if (Math.hypot(p.x - h.x, p.y - h.y) < h.r + p.r * 0.5) hurtPlayer(h.dmg); }
    }
    for (const q of G.pickups) if (q.net && q.tx !== undefined) { q.x += (q.tx - q.x) * k; q.y += (q.ty - q.y) * k; q.t += dt; if (q.kind === 'chest') q.afford = q.free || G.gold >= chestCost(); }
  };
  // guest: a hit landed locally -> show it now, tell the host
  N.queueDmg = (b, d) => {
    b.pend = b.pend || []; b.pend.push([performance.now(), d]);
    (b.qd = b.qd || { d: 0, src: SRC }).d += d; b.qd.src = SRC;
    if (!b.queued) { b.queued = true; dmgQ.push(b); }
  };
  N.localPop = b => { b.dead = true; popFx(b); };
  // collect damage + status changes since the last send
  function flushDamage() {
    const list = [];
    const all = G.bloons.concat(G.boss && !G.boss.dead ? [G.boss] : []);
    for (const b of all) {
      const base = b.base; let st = null;
      if (base) {
        const ds = b.slowT > base.slowT + 0.05 ? r2(b.slowT) : 0, df = b.frozenT > base.frozenT + 0.05 ? r2(b.frozenT) : 0, dn = b.stunT > base.stunT + 0.05 ? r2(b.stunT) : 0;
        const db = b.burnT > base.burnT + 0.05 ? r2(b.burnT) : 0, dh = (b.hexT || 0) > base.hexT + 0.05 ? r2(b.hexT) : 0;
        if (ds || df || dn || db || dh || b.kx || b.ky) st = [ds, df, dn, db, r1(b.burnD || 0), dh, r1(b.hexD || 0), r2(b.kx || 0), r2(b.ky || 0)];
        if (st) { base.slowT = b.slowT; base.frozenT = b.frozenT; base.stunT = b.stunT; base.burnT = b.burnT; base.hexT = b.hexT || 0; b.kx = b.ky = 0; }
      }
      const q = b.queued ? b.qd : null;
      if (!q && !st) continue;
      const s = st || [0, 0, 0, 0, 0, 0, 0, 0, 0];
      list.push([b.isBoss ? -1 : b.nid, q ? r1(q.d) : 0, q ? q.src : (b.burnSrc || SRC || 'hero'), ...s]);
      b.queued = false; b.qd = null;
    }
    dmgQ.length = 0;
    return list;
  }
  // guest: things the host decided for me
  function onEvents(m) {
    if (!G) return;
    for (const [src, ti, base, x, y, golden] of m.g || []) {
      const type = BT[ti], def = BLOONS[type]; if (!def) continue;
      const gold = base * goldMult();
      G.gold += gold; G.goldEarned += gold;
      const r = rs(src); r.pops++; r.gold += gold;
      META.pop({ def, type, x, y });
      if (golden) { play('PopGolden', { vol: 1 }); G.texts.push({ x, y: y - 1, s: '+$' + Math.round(gold), t: 0, life: 1.4, gold: true }); }
    }
    for (const d of m.hurt || []) hurtPlayer(d);
    for (const f of m.heal || []) { const s = G.stats, p = G.player; if (p.down) continue; rs('hero').heal += Math.min(s.maxhp - p.hp, s.maxhp * f); p.hp = Math.min(s.maxhp, p.hp + s.maxhp * f); toast('+30% health', '#ff7a8a'); }
    for (const [free, x, y] of m.chest || []) {
      const cost = free ? 0 : chestCost();
      G.gold -= cost; if (!free) G.chestsOpened++; G.chests++;
      G.pendingChest = (G.pendingChest || 0) + 1;
      play('UIChestOpen03', { vol: 0.9 }); play('MoneybagsOpen', { vol: 0.6 }); META.chest(x, y);
      if (cost) G.texts.push({ x: G.player.x, y: G.player.y - 1, s: '-$' + cost, t: 0, life: 1, gold: true });
      openLevelUp(true);
    }
  }
  function onMech(m) {
    if (!G) return;
    const p = G.player;
    if (m.id === 'lych') {
      let stole = 0;
      if (p.buffT > 0 && p.buffT < 1e8) { p.buffT = 0; stole++; }
      for (const k in G.buf) if (G.buf[k] > 0) { G.buf[k] = 0; stole++; }
      G.drainT = 6; G.effects.push({ kind: 'ring', x: p.x, y: p.y, r: 3, t: 0, life: 0.6, color: '#a040ff' });
      play('BossLychEtherealize', { vol: 0.7 }); toast('☠ The Lych drains your power!' + (stole ? ' (buffs stolen)' : ''), '#c070ff');
    } else if (m.id === 'phayze') { play('BossPhayzeSummonPortal', { vol: 0.7 }); toast('☠ Phayze warps reality — you are blinded!', '#33ddff'); }
    else if (m.id === 'vortex') { play('VortexTornado0*', { vol: 0.7 }); toast('☠ Vortex shorts out your towers!', '#9fd6ff'); }
  }
  function onBossKill(m) {
    if (!G) return;
    const def = BOSSES.find(d => d.id === m.id); if (!def) return;
    G.bossKills++;
    META.bossKill({ def, x: m.x, y: m.y, dashAtSpawn: G.boss && G.boss.dashAtSpawn !== undefined ? G.boss.dashAtSpawn : G.dashesUsed });
    if (G.boss) G.boss.dead = true;
    shake(1); play(BOSS_SFX[def.id][1], { vol: 1 });
    G.effects.push({ kind: 'expl', x: m.x, y: m.y, r: 4, t: 0, life: 0.9, net: true });
    setTimeout(() => G && toast(`${def.name} DEFEATED!  Stand in a portal and press E`, '#ffe39a'), 600);
  }

  // ------------------------------------------------------------------ host takes over
  function promote() {
    N.role = 'host';
    toast('The host left — you are now hosting the run', '#ffe39a');
    // turn the mirrored world into a real one
    for (const b of G.bloons) { b.net = false; b.spd = bloonSpd(b.def) * (b.jit || 1); b.anc = b.anc || []; b.slowT = b.slowT || 0; if (b.tx !== undefined) { b.x = b.tx; b.y = b.ty; } }
    G.bloons = G.bloons.filter(b => !b.dead);
    if (G.boss && !G.boss.dead) { const B = G.boss; B.net = false; B.mechT = B.mechT ?? 8; B.atkT = B.atkT ?? 3; B.skulls = B.skulls || []; B.blimpSkull = B.blimpSkull ?? 0; }
    G.pickups = G.pickups.map(q => { q.net = false; if (q.owner && q.owner !== N.me.id) q.dead = true; if (q.kind === 'soul' && !q.v) q.v = 1; return q; }).filter(q => !q.dead);
    G.hazards = G.hazards.concat((G.netHaz || []).map(h => Object.assign(h, { net: false })));
    G.netHaz = [];
    G.chestT = 30; G.spawnBudget = 0; G.flowT = 0;
    netBloons.clear();
  }

  // ------------------------------------------------------------------ per frame
  N.tick = dt => {
    if (!N.inRun || !G) return;
    stepPeers(dt);
    if (G.state === 'loading') return;
    sendT -= dt; worldT -= dt;
    if (sendT <= 0) { sendT = 1 / 12; const pk = myPeerPacket(); if (N.guest) { const d = flushDamage(); if (d.length) pk.d = d; } send('*', pk); }
    if (N.host) {
      if (G.state === 'play' && !N.worldHeld()) hostPickups(dt);
      if (worldT <= 0) {
        worldT = 0.1;
        send('*', worldPacket());
        for (const [to, o] of owed) send(to, Object.assign({ t: 'e' }, o));
        owed.clear();
      }
      N.allDownCheck();
    }
  };
  // guest: should I freeze (someone else is picking/paused/loading)?
  N.held = () => N.guest && N.paused.length > 0 && !(N.paused.length === 1 && N.paused[0] === N.me.name);

  // revive: stand next to a downed teammate (computed by the downed player's own game)
  N.reviveStep = dt => {
    const p = G.player; if (!p.down) return;
    const near = N.alivePeers().some(q => Math.hypot(q.x - p.x, q.y - p.y) < 1.9);
    p.rev = near ? (p.rev || 0) + dt : Math.max(0, (p.rev || 0) - dt * 0.5);
    if (p.rev >= 3) { p.down = false; p.rev = 0; p.hp = G.stats.maxhp * 0.4; p.inv = 2; toast('Revived!', '#7dff8a'); play('UIStar', { vol: 0.7 }); G.effects.push({ kind: 'ring', x: p.x, y: p.y, r: 2.5, t: 0, life: 0.6, color: '#7dff8a' }); }
  };

  // hero for the lobby tiles
  N.heroOf = id => { const l = N.lobby[id]; return l ? CHARS.find(c => c.id === l.hero) : null; };
  return N;
})();
window.NET = NET;
