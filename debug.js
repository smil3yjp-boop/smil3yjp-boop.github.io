// ================================================================ hidden debug / sandbox panel (solo runs only)
// Open with Ctrl+Shift+D or F9 during a solo run (or add ?debug to the URL for an on-screen DBG button).
// Opening it marks the run as a debug run: no Monkey Money, hero XP, achievements or highscores.
(() => {
  const URL_DBG = /[?&]debug\b/.test(location.search);
  let panel = null, meterT = 0, hist = [];
  const css = `
#dbg{position:fixed;top:64px;right:8px;width:330px;max-height:calc(100vh - 80px);overflow:auto;z-index:9000;background:rgba(14,12,22,.94);color:#e8e0d0;
 font:12px/1.35 system-ui,sans-serif;border:2px solid #ffb84d;border-radius:10px;padding:8px 10px;box-shadow:0 6px 24px #000a}
#dbg h3{margin:0 0 4px;font-size:14px;color:#ffb84d;display:flex;justify-content:space-between;align-items:center}
#dbg .warn{color:#ff8a7a;font-size:11px;margin-bottom:6px}
#dbg .sec{border-top:1px solid #ffffff22;padding-top:6px;margin-top:6px}
#dbg .lbl{color:#9fb3c8;font-size:11px;margin:2px 0}
#dbg .row{display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin:3px 0}
#dbg button{background:#2c2840;color:#fff;border:1px solid #5a5478;border-radius:6px;padding:3px 7px;font:inherit;cursor:pointer}
#dbg button:hover{background:#3d3858}
#dbg button.on{background:#2f6b3a;border-color:#6fd47f}
#dbg select,#dbg input{background:#1d1a2b;color:#fff;border:1px solid #5a5478;border-radius:5px;padding:2px 4px;font:inherit}
#dbg input[type=number]{width:52px}
#dbg table{width:100%;border-collapse:collapse;font-size:11px}
#dbg td{padding:1px 3px}#dbg td.n{text-align:right;font-variant-numeric:tabular-nums}
#dbg .bar{height:4px;background:#ffb84d;border-radius:2px}
#dbgbtn{position:fixed;top:64px;right:8px;z-index:8999;background:#ffb84d;color:#000;border:0;border-radius:6px;padding:4px 8px;font:bold 12px system-ui;cursor:pointer;display:none}`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  const btn = document.createElement('button'); btn.id = 'dbgbtn'; btn.textContent = 'DBG'; document.body.appendChild(btn);
  btn.onclick = () => toggle();

  const solo = () => typeof G !== 'undefined' && G && G.player && !(NET.on || G.coop);
  const say = (m, c = '#ffb84d') => { try { toast(m, c); } catch (e) { console.log(m); } };
  const fmt = v => v >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e4 ? (v / 1e3).toFixed(1) + 'k' : Math.round(v).toLocaleString();
  const towerIds = () => Object.keys(SKILLS).filter(k => PATHS[k] || SUPPORT_PATHS[k]);
  const srcName = s => s === 'hero' ? (G.ch ? G.ch.name : 'Hero') : SKILLS[s] ? (G.skillOf && G.skillOf[s] && G.skillOf[s].paragon ? PARAGONS[s] : SKILLS[s].name) : s;

  function toggle() {
    if (panel) { panel.remove(); panel = null; return; }
    if (!solo()) { say(typeof G !== 'undefined' && G ? 'Debug panel only works in solo runs' : 'Start a solo run first, then open the debug panel'); return; }
    if (!G.debug) { G.debug = true; G.runStats0 = JSON.parse(JSON.stringify(G.runStats || {})); hist = []; say('DEBUG RUN: no Monkey Money, XP, achievements or highscores this run', '#ff8a7a'); }
    build();
  }
  addEventListener('keydown', e => {
    if ((e.code === 'KeyD' && e.ctrlKey && e.shiftKey) || e.code === 'F9') { e.preventDefault(); e.stopPropagation(); toggle(); }
  }, true);

  function el(tag, attrs = {}, kids = []) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) if (k === 'on') n.onclick = v; else if (k === 'text') n.textContent = v; else n.setAttribute(k, v);
    for (const c of [].concat(kids)) n.append(c);
    return n;
  }
  const b = (t, f, cls) => el('button', { text: t, on: () => { try { f(); } catch (e) { console.error(e); say('Debug: ' + e.message, '#ff8a7a'); } sync(); }, ...(cls ? { class: cls } : {}) });
  const sel = (opts, v) => { const s = el('select'); for (const [val, txt] of opts) { const o = el('option', { value: val, text: txt }); if (String(val) === String(v)) o.selected = true; s.append(o); } return s; };
  const lbl = t => el('div', { class: 'lbl', text: t });
  const row = (...k) => el('div', { class: 'row' }, k);

  let tg = {}, meterBox, info;
  function build() {
    panel = el('div', { id: 'dbg' });
    // typing in the panel must not move the hero or trigger hotkeys
    for (const ev of ['keydown', 'keyup']) panel.addEventListener(ev, e => { if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') e.stopPropagation(); });
    panel.append(el('h3', {}, ['DEBUG / SANDBOX', el('button', { text: '✕', on: toggle })]));
    panel.append(el('div', { class: 'warn', text: 'Debug run: no rewards, achievements or highscores. Ctrl+Shift+D / F9 to hide.' }));
    info = el('div', { class: 'lbl' }); panel.append(info);

    // --- run toggles
    const sec1 = el('div', { class: 'sec' });
    tg.god = b('God mode', () => { G.dbgGod = !G.dbgGod; });
    tg.spawn = b('Pause spawns', () => { G.dbgNoSpawn = !G.dbgNoSpawn; });
    tg.enr = b('No enrage', () => { G.dbgNoEnrage = !G.dbgNoEnrage; });
    sec1.append(row(tg.god, tg.spawn, tg.enr));
    tg.sp = [1, 2, 4].map(n => b(n + 'x', () => { G.dbgSpeed = n; }));
    sec1.append(row(el('span', { class: 'lbl', text: 'Speed' }), ...tg.sp));
    sec1.append(row(
      b('Kill bloons', () => { for (const o of G.bloons) o.dead = true; G.bloons = []; G.eproj.length = 0; }),
      b('Heal', () => { G.player.hp = G.stats.maxhp; G.player.down = false; }),
      b('+1 level', () => { gainXp((G.xpNext - G.xp) / (G.stats.xp * G.chaos.xp) + 0.01); }),
      b('Clear hazards', () => { G.hazards = []; G.eproj.length = 0; })));
    panel.append(sec1);

    // --- loop / chaos
    const sec2 = el('div', { class: 'sec' });
    const loopIn = el('input', { type: 'number', min: 0, max: 30, value: G.loop });
    const chaosSel = sel(CHAOS.map((c, i) => [i, `Chaos ${c.n} · ${CHAOS_NAME[i]}`]), G.chaosIdx);
    sec2.append(lbl('Loop (0 = first) and Chaos: affects bloons and bosses spawned from now on'));
    sec2.append(row(el('span', { class: 'lbl', text: 'Loop' }), loopIn, chaosSel, b('Apply', () => {
      G.loop = Math.max(0, Math.min(30, +loopIn.value | 0)); G.chaosIdx = +chaosSel.value; G.chaos = Object.assign({}, CHAOS[G.chaosIdx]);
      say(`Loop ${G.loop + 1} · Chaos ${CHAOS[G.chaosIdx].n}`);
    })));
    panel.append(sec2);

    // --- bosses
    const sec3 = el('div', { class: 'sec' });
    const bossSel = sel([...BOSSES.map(d => [d.id, d.name]), ...FINAL_BOSSES.map(d => [d.id, '★ ' + d.name + ' (final)'])], BOSSES[0].id);
    const clearBoss = () => { if (G.boss) { G.boss.dead = true; G.boss = null; } G.hazards = G.hazards.filter(h => !VOID_HZ.has(h.kind)); G.finalFight = false; };
    sec3.append(lbl('Boss (uses the current loop and Chaos for its health)'));
    sec3.append(row(bossSel, b('Spawn', () => {
      const def = bossDef(bossSel.value); clearBoss(); G.portals = null;
      if (def.final) startFinalBoss(def.id); else spawnBoss(def);
    }), b('Dummy', () => {   // training dummy: never moves, attacks or dies; for measuring damage
      const def = bossDef(bossSel.value); clearBoss(); G.portals = null;
      if (def.final) { say('Dummy uses a regular boss model', '#ff8a7a'); return; }
      const ne = G.dbgNoEnrage; G.dbgNoEnrage = true; spawnBoss(def); G.dbgNoEnrage = ne; const B = G.boss; B.dummy = true; B.hp = B.maxhp = 1e12; B.skulls = []; B.enraged = false; G.bossIntro = 0;
      const a = Math.random() * Math.PI * 2;
      for (let d = 11; d < 18; d++) { const x = G.player.x + Math.cos(a) * d, y = G.player.y + Math.sin(a) * d; if (G.arena.isWalk(x, y)) { B.x = x; B.y = y; break; } }
      resetMeter(); say('Training dummy: stand still and read the damage meter');
    })));
    sec3.append(row(el('span', { class: 'lbl', text: 'Boss HP' }),
      ...[0.76, 0.51, 0.26].map(f => b(Math.round(f * 100 - 1) + '%', () => { if (G.boss && !G.boss.dummy) G.boss.hp = G.boss.maxhp * f - 1; })),
      b('Kill', () => { const B = G.boss; if (!B || B.dead) return; B.dummy = false; B.skulls = []; B.hp = 1; SRC = 'debug'; damage(B, 1e15, ['proj']); }),
      b('Remove', clearBoss)));
    panel.append(sec3);

    // --- towers
    const sec4 = el('div', { class: 'sec' });
    const twSel = sel(towerIds().map(k => [k, SKILLS[k].name]), towerIds()[0]);
    const lvSel = sel([[1, 'Lv 1'], [2, 'Lv 2'], [3, 'Lv 3'], [4, 'Lv 4'], [5, 'Lv 5'], [6, 'Lv 6'], [7, 'Lv 7 (max)'], [8, 'Paragon']], 7);
    const p3 = sel([['T', 'Top'], ['M', 'Mid'], ['B', 'Bot']], 'T'), p5 = sel([['T', 'Top'], ['M', 'Mid'], ['B', 'Bot']], 'T');
    sec4.append(lbl('Towers (base damage, no rarity bonuses from cards)'));
    sec4.append(row(twSel, lvSel));
    sec4.append(row(el('span', { class: 'lbl', text: 'Path at 3' }), p3, el('span', { class: 'lbl', text: 'at 5' }), p5));
    sec4.append(row(b('Set tower', () => {
      const id = twSel.value, lv = +lvSel.value, sk = hasSkill(id) || addSkill(id);
      sk.def = SKILLS[id]; sk.paragon = false; sk.lv = Math.min(lv, MAXLV);
      sk.path3 = sk.lv >= 3 ? p3.value : undefined; sk.path5 = sk.lv >= 5 ? p5.value : undefined;
      if (lv === 8) {
        if (!PARAGONS[id]) { say(`${SKILLS[id].name} has no Paragon`, '#ff8a7a'); return; }
        sk.lv = 8; sk.paragon = true;
        sk.def = Object.assign({}, sk.def, { name: PARAGONS[id], dmg: sk.def.dmg * ((PARAGON_TUNE[id] || {}).dmg || 3), cd: sk.def.cd * 0.6 });
      }
      sk.cd = 0.2; say(`${sk.def.name}: ${lv === 8 ? 'Paragon' : 'level ' + sk.lv + (sk.path3 ? ' · ' + curPath(sk) : '')}`);
    }), b('Remove', () => {
      const i = G.skills.findIndex(s => s.id === twSel.value && !s.hero); if (i < 0) return;
      G.skills.splice(i, 1); delete G.skillOf[twSel.value]; if (G.towerPos) delete G.towerPos[twSel.value];
    }), b('Remove all', () => {
      for (const s of G.skills.filter(s => !s.hero)) { delete G.skillOf[s.id]; if (G.towerPos) delete G.towerPos[s.id]; }
      G.skills = G.skills.filter(s => s.hero);
    })));
    panel.append(sec4);

    // --- damage meter
    const sec5 = el('div', { class: 'sec' });
    sec5.append(row(el('span', { class: 'lbl', text: 'Damage meter · DPS over the last 10 s of game time' }), b('Reset', resetMeter)));
    meterBox = el('div'); sec5.append(meterBox);
    panel.append(sec5);
    document.body.append(panel);
    sync(); meter(true);
  }

  function resetMeter() { G.runStats0 = JSON.parse(JSON.stringify(G.runStats || {})); G.dbgT0 = G.t; hist = []; }
  function totals() {
    const out = {}, base = G.runStats0 || {};
    for (const [k, v] of Object.entries(G.runStats || {})) { if (k === 'debug') continue; const d = v.dmg - ((base[k] || {}).dmg || 0); if (d > 0) out[k] = d; }
    return out;
  }
  function sync() {
    if (!panel || !G) return;
    tg.god.classList.toggle('on', !!G.dbgGod); tg.spawn.classList.toggle('on', !!G.dbgNoSpawn); tg.enr.classList.toggle('on', !!G.dbgNoEnrage);
    tg.sp.forEach((x, i) => x.classList.toggle('on', ((G.dbgSpeed || 1) === [1, 2, 4][i])));
  }
  function meter(force) {
    if (!panel || !G || !meterBox) return;
    if (G.dbgT0 === undefined) G.dbgT0 = G.t;
    const tot = totals(); hist.push({ t: G.t, tot }); while (hist.length > 2 && G.t - hist[0].t > 10) hist.shift();
    const old = hist[0], span = Math.max(0.5, G.t - old.t);
    const rows = Object.entries(tot).map(([k, v]) => [k, v, (v - (old.tot[k] || 0)) / span]).sort((a, b) => b[2] - a[2] || b[1] - a[1]).slice(0, 14);
    const top = Math.max(1, ...rows.map(r => r[2])), sumDps = rows.reduce((a, r) => a + r[2], 0), sumTot = Object.values(tot).reduce((a, v) => a + v, 0);
    const B = G.boss && !G.boss.dead ? G.boss : null;
    info.textContent = `Loop ${G.loop + 1} · Chaos ${CHAOS[G.chaosIdx].n} · Lv ${G.level} · ${Math.floor(G.t / 60)}:${String(Math.floor(G.t % 60)).padStart(2, '0')} · bloons ${G.bloons.length}` +
      (B ? ` · ${B.def.name} ${B.dummy ? '(dummy)' : Math.round(100 * B.hp / B.maxhp) + '% of ' + fmt(B.maxhp)}` : '');
    const tb = el('table');
    tb.append(el('tr', {}, [el('td', { text: 'Source' }), el('td', { class: 'n', text: 'DPS' }), el('td', { class: 'n', text: 'Total' }), el('td', { class: 'n', text: '%' })]));
    for (const [k, v, dps] of rows) {
      tb.append(el('tr', {}, [el('td', {}, [srcName(k), el('div', { class: 'bar', style: `width:${Math.round(100 * dps / top)}%` })]), el('td', { class: 'n', text: fmt(dps) }), el('td', { class: 'n', text: fmt(v) }), el('td', { class: 'n', text: sumTot ? Math.round(100 * v / sumTot) + '%' : '' })]));
    }
    tb.append(el('tr', {}, [el('td', { text: 'All' }), el('td', { class: 'n', text: fmt(sumDps) }), el('td', { class: 'n', text: fmt(sumTot) }), el('td')]));
    meterBox.replaceChildren(rows.length ? tb : el('div', { class: 'lbl', text: 'No damage yet' }));
  }
  setInterval(() => {
    btn.style.display = URL_DBG && !panel && solo() ? 'block' : 'none';
    if (panel && !(typeof G !== 'undefined' && G)) { panel.remove(); panel = null; return; }   // run ended
    if (panel && G.state !== 'loading') meter();
  }, 500);
  window.DEBUG = { toggle };
})();
