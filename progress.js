// Long-term progression: hero levels, Ascension (prestige), the Codex, and run history.
// Everything is stored in PROFILE, so it syncs to the player's Discord account like the rest of their save.
var PROG = (() => {
  // ------------------------------------------------------------------ hero levels
  const LV_XP = [0, 400, 1000, 1800, 2900, 4300, 6000, 8100, 10600, 13500];   // total XP needed for level 1..10
  const PERKS = [
    { lv: 2, name: 'Seasoned', desc: '+5% hero attack damage', apply: s => { s.heroDmg += 0.05; } },
    { lv: 3, name: 'Tough', desc: '+10% max health', apply: s => { s.maxhp *= 1.1; } },
    { lv: 4, name: 'Prepared', desc: '+1 reroll every run', apply: (s, g) => { g.rerolls++; } },
    { lv: 5, name: 'Focused', desc: 'Hero ability cooldown -10%', apply: s => { s.abilCdr = (s.abilCdr || 0) + 0.1; } },
    { lv: 6, name: 'Veteran', desc: '+8% hero attack damage', apply: s => { s.heroDmg += 0.08; } },
    { lv: 7, name: 'Funded', desc: 'Start runs with +$150', apply: (s, g) => { g.gold += 150; } },
    { lv: 8, name: 'Swift', desc: '+6% move speed', apply: s => { s.speed += 0.06; } },
    { lv: 9, name: 'Elite', desc: '+1 hero projectile / extra swing', apply: s => { s.heroExtra = Math.min(5, s.heroExtra + 1); } },
    { lv: 10, name: 'Heroic Surge', desc: 'Your ability also gives +60% attack speed for 6s', apply: (s, g) => { g.surge = true; } },
  ];
  const xpOf = id => (PROFILE.heroXp && PROFILE.heroXp[id]) || 0;
  function levelOf(id) { const x = xpOf(id); let l = 1; while (l < LV_XP.length && x >= LV_XP[l]) l++; return l; }
  function progressOf(id) {
    const l = levelOf(id), x = xpOf(id);
    if (l >= LV_XP.length) return { l, cur: 1, need: 1, max: true };
    return { l, cur: x - LV_XP[l - 1], need: LV_XP[l] - LV_XP[l - 1], max: false };
  }

  // ------------------------------------------------------------------ Ascension
  const ASC_MAX = 15;   // highest Ascension rank
  const pres = () => Math.min(ASC_MAX, PROFILE.prestige || 0);
  const PRES = { dmg: 0.04, xp: 0.04, mm: 0.1 };
  const knowMaxed = () => KNOWLEDGE.every(k => kLv(k.id) >= k.costs.length);

  // run start: hero perks + ascension bonuses
  function start(stats, g) {
    const id = g.ch.id, l = levelOf(id);
    for (const p of PERKS) if (l >= p.lv) p.apply(stats, g);
    const n = pres(); stats.dmg += n * PRES.dmg; stats.xp += n * PRES.xp;
    g.player.hp = stats.maxhp;
    g.startLv = l;
  }
  const mmMult = () => 1 + pres() * PRES.mm;

  // ------------------------------------------------------------------ Codex
  function seen(cat, id) {
    const c = PROFILE.codex || (PROFILE.codex = { b: {}, t: {}, r: {}, x: {} });
    const m = c[cat] || (c[cat] = {});
    if (!m[id]) { m[id] = 1; seen.dirty = true; }
  }

  // ------------------------------------------------------------------ end of run: hero XP + history
  function finish(win, quit) {
    if (!G) return [];
    const id = G.ch.id, before = levelOf(id);
    const xp = Math.round(G.level * 12 + G.bossKills * 250 + G.loop * 150 + G.t / 2 + (win ? 100 : 0));
    PROFILE.heroXp = PROFILE.heroXp || {}; PROFILE.heroXp[id] = xpOf(id) + xp;
    const after = levelOf(id);
    // run history (newest first, last 20)
    const h = PROFILE.history || (PROFILE.history = []);
    h.unshift({
      d: Date.now(), h: id, sk: (selectedSkin(G.ch) || {}).icon || null, m: G.arena.def.name, c: G.chaos.n, r: $('endbanner').textContent, lv: G.level, lp: G.loop, t: Math.round(G.t),
      dmg: Math.round(G.dmgDealt), pops: Object.values(G.runStats || {}).reduce((a, r) => a + (r.pops || 0), 0), b: G.bossKills, n: NET.on ? 1 + NET.runIds.size : 1,
      tw: G.skills.filter(k => !k.hero).map(k => [k.id, k.lv, k.path3 || 0, k.path5 || 0, k.paragon ? 1 : 0]),
      rl: (G.relics || []).slice(), it: Object.values(G.items).sort((a, b) => b.n - a.n).slice(0, 8).map(it => [it.name, it.n]),
    });
    if (h.length > 20) h.length = 20;
    saveProfile();
    const rows = [['Hero XP', `+${xp}  (${G.ch.name} Lv ${after})`]];
    if (after > before) {
      const got = PERKS.filter(p => p.lv > before && p.lv <= after).map(p => p.name).join(', ');
      rows.push(['LEVEL UP!', `${G.ch.name} reached Lv ${after}${got ? ' · ' + got : ''}`]);
      setTimeout(() => play('UIHeroUnlock', { vol: 0.7 }), 600);
    }
    return rows;
  }

  // ------------------------------------------------------------------ menu: hero level panel
  function renderHeroLevel(ch) {
    const el = $('hlevel'); if (!el) return;
    const p = progressOf(ch.id), next = PERKS.find(q => q.lv > p.l);
    el.innerHTML = `<div class="hlv"><b>LV ${p.l}</b><i><s style="width:${p.max ? 100 : Math.round(p.cur / p.need * 100)}%"></s></i><span>${p.max ? 'MAX' : `${p.cur.toLocaleString()} / ${p.need.toLocaleString()} XP`}</span></div>` +
      `<div class="hperks">${PERKS.map(q => `<span class="${p.l >= q.lv ? 'on' : ''}" data-tip="<b>Lv ${q.lv} · ${q.name}</b><div>${q.desc}</div><div class='tdim'>${p.l >= q.lv ? 'Unlocked' : `Unlocks at level ${q.lv}`}</div>">${q.lv}</span>`).join('')}</div>` +
      (next ? `<div class="hnext">Next at Lv ${next.lv}: <b>${next.name}</b> — ${next.desc}</div>` : `<div class="hnext"><b>Mastered</b> — every perk unlocked</div>`);
  }

  // ------------------------------------------------------------------ Knowledge page: ascension box
  let ascArm = false;
  function renderAscend() {
    const box = $('kasc'); if (!box) return;
    const n = pres(), maxed = n >= ASC_MAX, ready = knowMaxed() && !maxed;
    box.innerHTML = `<div class="kat"><b>ASCENSION ${'★'.repeat(n) || '—'}</b><span>${n ? `Rank ${n}/${ASC_MAX}: +${Math.round(n * PRES.dmg * 100)}% damage · +${Math.round(n * PRES.xp * 100)}% XP gain · +${Math.round(n * PRES.mm * 100)}% Monkey Money (permanent)` : 'Max out every Knowledge upgrade to Ascend'}</span></div>` +
      `<button class="btn small" id="ascbtn" ${ready ? '' : 'disabled'}>${maxed ? 'MAX ASCENSION REACHED' : ascArm ? 'CLICK AGAIN TO RESET KNOWLEDGE' : `ASCEND → +${Math.round(PRES.dmg * 100)}% dmg · +${Math.round(PRES.xp * 100)}% xp · +${Math.round(PRES.mm * 100)}% MM`}</button>`;
    const b = $('ascbtn');
    b.onclick = () => {
      if (!knowMaxed() || pres() >= ASC_MAX) return;
      if (!ascArm) { ascArm = true; renderAscend(); setTimeout(() => { ascArm = false; renderAscend(); }, 4000); return; }
      ascArm = false; PROFILE.prestige = n + 1; PROFILE.know = {}; saveProfile();
      play('UpgradeParagonDartMonkey', { vol: 0.9 }); META.ach('ascend');
      renderKnowledge(); buildMenu();
    };
  }

  // ------------------------------------------------------------------ Codex page
  const BOSS_MECH = { bloonarius: 'Spews slime bloons and sticky slime puddles that slow you.', lych: 'Drains your buffs and heals; Mini-Lychs feed it while alive.', vortex: 'Gales of wind-boosted bloons and storms that stun your towers.',
    dreadbloon: 'Armoured Rock Bloons protect it.', phayze: 'Blinds you and sends phasing bloons through reality.', blastapopoulos: 'Molten rock bloons leave pools of magma behind.' };
  let ctab = 'b';
  function codexEntries(cat) {
    const c = (PROFILE.codex || {})[cat] || {};
    if (cat === 'b') return Object.entries(BLOONS).map(([k, d]) => ({ id: k, got: !!c[k], name: k === 'lychmini' ? 'Mini-Lych' : k.toUpperCase(), spr: d.spr,
      rows: [['Health', d.hp.toLocaleString()], ['Speed', d.sm ? `${Math.round(d.sm * 100)}% of yours` : (d.spd || '—')], ['Contact damage', d.dmg], ['XP', d.xp], ['Layers', d.kids.length ? d.kids.map(q => q[0]).join(', ') : d.moab ? 'blimp' : 'last layer']] }));
    if (cat === 't') return Object.entries(SKILLS).map(([k, d]) => ({ id: k, got: !!c[k], name: d.name, sprs: d.icon, desc: d.desc,
      rows: [['Damage', d.dmg], ['Cooldown', d.cd + 's'], ['Tags', (d.tags || []).map(t => TAGNAME[t] || t).join(', ')], ...(PATHS[k] ? [['Paths', PATHS[k].map(p => p[2]).join(' · ')]] : [])] }));
    if (cat === 'r') return RELICS.concat(Object.values(ESSENCE)).map(r => ({ id: r.id, got: !!c[r.id], name: r.name, png: `assets/ui/relic/${r.icon}.png`, desc: r.desc, rows: r.set ? [['Set', RELIC_SETS[r.set].name]] : [['Type', 'Boss essence']] }));
    return BOSSES.map(b => ({ id: b.id, got: !!c[b.id], name: b.name, png: `assets/ui/${BOSS_PORTRAIT[b.id]}.png`, desc: `${b.title}. ${BOSS_MECH[b.id] || ''}`, rows: [['Base health', b.hp.toLocaleString()], ['Speed', b.spd]] }));
  }
  function renderCodex() {
    const tabs = { b: 'Bloons', t: 'Towers', r: 'Relics', x: 'Bosses' };
    $('cxtabs').innerHTML = Object.entries(tabs).map(([k, n]) => { const e = codexEntries(k); return `<button class="btn small${k === ctab ? ' on' : ''}" data-t="${k}">${n} ${e.filter(q => q.got).length}/${e.length}</button>`; }).join('');
    $('cxtabs').querySelectorAll('button').forEach(b => b.onclick = () => { ctab = b.dataset.t; renderCodex(); });
    const list = codexEntries(ctab), box = $('cxlist'); box.innerHTML = '';
    for (const e of list) {
      const el = document.createElement('div'); el.className = 'cxe' + (e.got ? '' : ' locked');
      el.innerHTML = `<div class="cxi">${e.png ? `<img src="${e.png}">` : '<canvas width="72" height="72"></canvas>'}</div><div class="cxt"><div class="cxn">${e.got ? e.name : '???'}</div>` +
        (e.got ? `${e.desc ? `<div class="cxd">${e.desc}</div>` : ''}<div class="cxr">${e.rows.map(([a, b]) => `<span>${a} <b>${b}</b></span>`).join('')}</div>` : `<div class="cxd">Not yet encountered</div>`) + `</div>`;
      const cv = el.querySelector('canvas');
      if (cv) spriteToCanvas(cv, e.spr || pickSpr(e.sprs || []), '#555');
      box.appendChild(el);
    }
  }

  // ------------------------------------------------------------------ Run history page
  const fmtT = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  function renderHistory() {
    const h = PROFILE.history || [], box = $('hilist');
    if (!h.length) { box.innerHTML = '<div class="cxd" style="padding:20px">No runs yet — your last 20 runs will show up here.</div>'; return; }
    box.innerHTML = '';
    h.forEach((r, i) => {
      const ch = CHARS.find(c => c.id === r.h) || CHARS[0];
      const el = document.createElement('div'); el.className = 'hirow';
      const good = /COMPLETE|GLORY/.test(r.r || '');
      el.innerHTML = `<div class="hih"><img src="${heroIconSrc(r.sk || HERO_ICON[ch.id])}"><div class="hiw"><b class="${good ? 'ok' : 'bad'}">${r.r || ''}</b><span>${ch.name} · ${r.m} · Chaos ${r.c}${r.n > 1 ? ` · co-op ×${r.n}` : ''}</span></div>
        <div class="his"><span>Lv <b>${r.lv}</b></span><span>Loop <b>${r.lp + 1}</b></span><span><b>${fmtT(r.t)}</b></span><span><b>${(r.dmg || 0).toLocaleString()}</b> dmg</span><span class="hid">${new Date(r.d).toLocaleDateString()}</span></div></div>
        <div class="hib hidden"><div class="hitw"></div><div class="hirl">${(r.rl || []).map(id => { const R = relicById(id); return R ? `<img title="${R.name} — ${R.desc}" src="assets/ui/relic/${R.icon}.png">` : ''; }).join('') || '<span class="cxd">No relics</span>'}</div>
        <div class="hiit">${(r.it || []).map(([n, c]) => `<span>${n}${c > 1 ? ' ×' + c : ''}</span>`).join('')}</div></div>`;
      const tw = el.querySelector('.hitw');
      for (const [id, lv, p3, p5, para] of r.tw || []) {
        const d = SKILLS[id]; if (!d) continue;
        const t = document.createElement('div'); t.className = 'hit';
        const path = [p3, p5].filter(Boolean).map(L => PATHS[id] ? PATHS[id][{ T: 0, M: 1, B: 2 }[L]][0] : L);
        t.innerHTML = `<canvas width="56" height="56"></canvas><b>${para ? PARAGONS[id] || d.name : d.name}</b><span>Lv ${lv}${path.length ? ' · ' + path.join(' → ') : ''}</span>`;
        spriteToCanvas(t.querySelector('canvas'), pickSpr(d.icon), '#a7794a'); tw.appendChild(t);
      }
      if (!(r.tw || []).length) tw.innerHTML = '<span class="cxd">No towers</span>';
      el.querySelector('.hih').onclick = () => el.querySelector('.hib').classList.toggle('hidden');
      box.appendChild(el);
    });
  }

  return { start, mmMult, seen, finish, renderHeroLevel, renderAscend, renderCodex, renderHistory, levelOf, PERKS };
})();
window.PROG = PROG;

// buttons + pages
$('codexbtn').onclick = () => { PROG.renderCodex(); show('codexpage', true); play('UIClick01', { vol: 0.5 }); };
$('histbtn').onclick = () => { PROG.renderHistory(); show('histpage', true); play('UIClick01', { vol: 0.5 }); };
for (const id of ['codexpage', 'histpage']) $(id).onclick = e => { if (e.target.id === id || e.target.classList.contains('pclose')) show(id, false); };
