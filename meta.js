// Bloonstone Survivors — meta systems: relics + set bonuses, Monkey Knowledge, hero unlocks, achievements,
// settings (screen shake, colourblind labels, key remapping), gamepad + touch controls, combo counter.
'use strict';

// ================================================================ settings + key bindings
const DEFAULT_KEYS = { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', dash: 'Space', ability: 'KeyR', interact: 'KeyE', aim: 'KeyQ', pause: 'Escape' };
const KEY_LABEL = { up: 'Move up', down: 'Move down', left: 'Move left', right: 'Move right', dash: 'Dash', ability: 'Hero ability', interact: 'Enter portal', aim: 'Toggle mouse aim', pause: 'Pause' };
let SETTINGS = { shake: true, cbLabels: false, dmgNumbers: true, keys: Object.assign({}, DEFAULT_KEYS) };
try { const s = JSON.parse(localStorage.getItem('bss_settings') || '{}'); SETTINGS = Object.assign(SETTINGS, s); SETTINGS.keys = Object.assign({}, DEFAULT_KEYS, s.keys || {}); } catch (e) { }
function saveSettings() { try { localStorage.setItem('bss_settings', JSON.stringify(SETTINGS)); } catch (e) { } }
const keyName = c => c.replace(/^Key/, '').replace(/^Digit/, '').replace('Arrow', '↑').replace('Escape', 'Esc').replace('Space', 'Space').replace('ShiftLeft', 'L-Shift').replace('ShiftRight', 'R-Shift');
// held state for an action (keyboard, arrows for movement, gamepad and touch all feed in)
function held(action) {
  const k = SETTINGS.keys[action];
  if (keys[k]) return true;
  const alt = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' }[action];
  return !!(alt && keys[alt]);
}
function moveAxis() {
  let mx = (held('right') ? 1 : 0) - (held('left') ? 1 : 0), my = (held('down') ? 1 : 0) - (held('up') ? 1 : 0);
  if (PAD.mx || PAD.my) { mx = PAD.mx; my = PAD.my; }
  if (TOUCH.stick) { mx = TOUCH.stick.dx; my = TOUCH.stick.dy; }
  return [mx, my];
}

// ================================================================ gamepad
const PAD = { mx: 0, my: 0, prev: [], sel: 0 };
function pollPad() {
  const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
  const gp = pads[0]; if (!gp) { PAD.mx = PAD.my = 0; return; }
  const dz = v => Math.abs(v) < 0.2 ? 0 : v;
  PAD.mx = dz(gp.axes[0] || 0); PAD.my = dz(gp.axes[1] || 0);
  if (gp.buttons[14] && gp.buttons[14].pressed) PAD.mx = -1; if (gp.buttons[15] && gp.buttons[15].pressed) PAD.mx = 1;
  if (gp.buttons[12] && gp.buttons[12].pressed) PAD.my = -1; if (gp.buttons[13] && gp.buttons[13].pressed) PAD.my = 1;
  const down = i => gp.buttons[i] && gp.buttons[i].pressed && !PAD.prev[i];
  // A=0 B=1 X=2 Y=3 LB=4 RB=5 Back=8 Start=9
  if (G && G.state === 'levelup') {
    const cards = [...document.querySelectorAll('#cards .card')];
    if (down(14) || (gp.axes[0] < -0.6 && !PAD.stickL)) PAD.sel = Math.max(0, PAD.sel - 1);
    if (down(15) || (gp.axes[0] > 0.6 && !PAD.stickR)) PAD.sel = Math.min(cards.length - 1, PAD.sel + 1);
    PAD.stickL = gp.axes[0] < -0.6; PAD.stickR = gp.axes[0] > 0.6;
    cards.forEach((c, i) => c.classList.toggle('padsel', i === PAD.sel));
    if (down(0) && cards[PAD.sel]) cards[PAD.sel].click();
    if (down(2)) $('reroll').click();
  } else if (G && G.state === 'play') {
    if (down(0) || down(5)) tryDash();
    if (down(2) || down(4)) useAbility();
    if (down(1)) G.useKey = true;
    if (down(3)) { G.manualAim = !G.manualAim; toast(G.manualAim ? 'Mouse aim ON' : 'Auto aim ON'); }
  } else if (!G && !$('menu').classList.contains('hidden') && down(9)) $('start').click();
  if (down(9) && G && (G.state === 'play' || G.state === 'paused')) togglePause();
  if (G && G.state === 'end' && down(0) && !$('hsname').classList.contains('hidden')) $('hsnok').click();
  PAD.prev = gp.buttons.map(b => b.pressed);
}

// ================================================================ touch: left half = floating stick, buttons on the right
const TOUCH = { on: false, stick: null, id: null, btns: [] };
function touchButtons() { const u = H / 1080, r = 62 * u; return [{ id: 'dash', x: W - 150 * u, y: H - 300 * u, r }, { id: 'ability', x: W - 300 * u, y: H - 210 * u, r }, { id: 'interact', x: W - 150 * u, y: H - 450 * u, r: r * 0.8 }, { id: 'pause', x: W - 70 * u, y: 70 * u, r: r * 0.6 }]; }
function touchXY(t) { return [t.clientX * DPR, t.clientY * DPR]; }
cv.addEventListener('touchstart', e => {
  if (!G || G.state !== 'play') return;
  TOUCH.on = true; e.preventDefault();
  for (const t of e.changedTouches) {
    const [x, y] = touchXY(t);
    const b = touchButtons().find(b => Math.hypot(x - b.x, y - b.y) < b.r * 1.2);
    if (b) { if (b.id === 'dash') tryDash(); else if (b.id === 'ability') useAbility(); else if (b.id === 'interact') G.useKey = true; else togglePause(); continue; }
    if (x < W * 0.55 && TOUCH.id === null) { TOUCH.id = t.identifier; TOUCH.stick = { x0: x, y0: y, x, y, dx: 0, dy: 0 }; }
  }
}, { passive: false });
cv.addEventListener('touchmove', e => {
  for (const t of e.changedTouches) if (t.identifier === TOUCH.id && TOUCH.stick) {
    const [x, y] = touchXY(t), s = TOUCH.stick, R = 70 * H / 1080; s.x = x; s.y = y;
    let dx = (x - s.x0) / R, dy = (y - s.y0) / R; const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
    s.dx = Math.abs(dx) < 0.15 ? 0 : dx; s.dy = Math.abs(dy) < 0.15 ? 0 : dy;
  }
  e.preventDefault();
}, { passive: false });
const endTouch = e => { for (const t of e.changedTouches) if (t.identifier === TOUCH.id) { TOUCH.id = null; TOUCH.stick = null; } };
cv.addEventListener('touchend', endTouch); cv.addEventListener('touchcancel', endTouch);
function drawTouch(u) {
  if (!TOUCH.on || !G || G.state !== 'play') return;
  ctx.save(); ctx.globalAlpha = 0.55;
  const s = TOUCH.stick;
  if (s) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 3 * u; ctx.beginPath(); ctx.arc(s.x0, s.y0, 70 * u, 0, TAU); ctx.stroke(); ctx.fillStyle = '#ffe39a'; ctx.beginPath(); ctx.arc(s.x0 + s.dx * 70 * u, s.y0 + s.dy * 70 * u, 30 * u, 0, TAU); ctx.fill(); }
  for (const b of touchButtons()) { ctx.fillStyle = 'rgba(20,12,30,.7)'; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill(); ctx.strokeStyle = '#ffe39a'; ctx.stroke(); text({ dash: 'DASH', ability: 'ABILITY', interact: 'E', pause: 'II' }[b.id], b.x, b.y + 6 * u, 16 * u, '#fff', 'center'); }
  ctx.restore();
}

// ================================================================ combo counter + coloured damage numbers
function comboPop() {
  if (!G) return;
  G.combo = (G.comboT > 0 ? G.combo || 0 : 0) + 1; G.comboT = 2.2; G.comboBest = Math.max(G.comboBest || 0, G.combo);
  if (G.combo === 100 || G.combo === 250 || G.combo === 500 || G.combo === 1000) { toast(`${G.combo} COMBO!`, '#ffb347'); play('UIStar', { vol: 0.5 }); }
}
const DMG_COL = { crit: '#ffd23f', burn: '#ff8a3d', frost: '#8fe3ff', stun: '#ffe066', lightning: '#c7a8ff', hero: '#ffffff', normal: '#ffffff', poison: '#9dff6a' };
function drawCombo(u) {
  if (!G || !(G.comboT > 0) || (G.combo || 0) < 5) return;
  const x = W - 210 * u, y = 230 * u, k = clamp(G.comboT / 2.2, 0, 1);
  text(`${G.combo}`, x, y, (38 + Math.min(20, G.combo / 25)) * u, G.combo >= 250 ? '#ff6a3d' : G.combo >= 100 ? '#ffb347' : '#ffe39a', 'center');
  text('COMBO', x, y + 22 * u, 14 * u, '#cbbfa8', 'center');
  ctx.fillStyle = 'rgba(255,255,255,.2)'; ctx.fillRect(x - 50 * u, y + 30 * u, 100 * u, 4 * u); ctx.fillStyle = '#ffb347'; ctx.fillRect(x - 50 * u, y + 30 * u, 100 * u * k, 4 * u);
}

// ================================================================ colourblind labels
const CB_TAG = { red: 'R', blue: 'B', green: 'G', yellow: 'Y', pink: 'P', black: 'Bk', white: 'W', purple: 'Pu', zebra: 'Z', lead: 'L', rainbow: 'Rb', ceramic: 'C', golden: '$', rock: 'Rk', magma: 'Mg' };
function drawCbLabels(u) {
  if (!SETTINGS.cbLabels || !G) return;
  const p = G.player; let n = 0;
  const list = G.bloons.filter(b => !b.dead && !b.def.moab && (b.x - p.x) ** 2 + (b.y - p.y) ** 2 < 400).sort((a, b) => ((a.x - p.x) ** 2 + (a.y - p.y) ** 2) - ((b.x - p.x) ** 2 + (b.y - p.y) ** 2));
  for (const b of list) {
    if (++n > 70) break;
    const q = R3.project(b.x, b.y, b.r * 1.2, W, H); if (!q) continue;
    const t = (CB_TAG[b.type] || '?') + (b.camo ? '·c' : '') + (b.regrow ? '·r' : '') + (b.fort ? '·f' : '');
    ctx.font = `900 ${13 * u}px "Trebuchet MS",sans-serif`; const w = ctx.measureText(t).width + 8 * u;
    ctx.fillStyle = 'rgba(0,0,0,.75)'; roundRect(q[0] - w / 2, q[1] - 9 * u, w, 18 * u, 5 * u); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(t, q[0], q[1] + 5 * u);
  }
}

// ================================================================ relics (Soulstone-style item drops with set bonuses)
const RELIC_SETS = {
  marksman: { name: 'Marksman', color: '#7fd8ff', b2: '+1 projectile on every projectile skill', b4: '+25% projectile damage',
    a2: s => { s.proj += 1; }, a4: s => { s.tag.proj += 0.25; } },
  demolition: { name: 'Demolition', color: '#ffb347', b2: '+15% area size', b4: '+30% area damage', a2: s => { s.area += 0.15; }, a4: s => { s.tag.area += 0.3; } },
  frostfire: { name: 'Frostfire', color: '#ff7ab8', b2: '+20% fire & frost damage', b4: '+30% effect duration, +15% damage', a2: s => { s.tag.fire += 0.2; s.tag.frost += 0.2; }, a4: s => { s.dur += 0.3; s.dmg += 0.15; } },
  commander: { name: 'Commander', color: '#9dff6a', b2: '+20% summon & trap damage', b4: '+15% attack speed for all towers', a2: s => { s.tag.summon += 0.2; s.tag.trap += 0.2; }, a4: s => { s.cdr += 0.15; } },
  fortune: { name: 'Fortune', color: '#ffd84a', b2: '+25 max health', b4: '+30% gold, +3 luck', a2: (s, g) => { s.maxhp += 25; g.player.hp += 25; }, a4: s => { s.gold += 0.3; s.luck += 3; } },
  heroic: { name: 'Heroic', color: '#ffffff', b2: '+15% hero damage', b4: 'Ability cooldowns -25%, +1 hero projectile', a2: s => { s.heroDmg += 0.15; }, a4: s => { s.abilCdr = (s.abilCdr || 0) + 0.25; s.heroExtra = Math.min(5, s.heroExtra + 1); } },
};
const RELICS = [
  { id: 'hawk', set: 'marksman', name: "Hawk's Eye", icon: 'ArtifactHawksEye', desc: '+10% projectile damage', a: s => s.tag.proj += 0.1 },
  { id: 'homing', set: 'marksman', name: 'Homing Projectiles', icon: 'ArtifactHomingProjectiles', desc: '+6% critical chance', a: s => s.crit += 0.06 },
  { id: 'bounce', set: 'marksman', name: 'Bouncing Projectiles', icon: 'ArtifactBouncingProjectiles', desc: '+1 pierce', a: s => s.pierce += 1 },
  { id: 'critsuc', set: 'marksman', name: 'Critical Success', icon: 'ArtifactCriticalSuccess', desc: '+25% critical damage', a: s => s.critMult += 0.25 },
  { id: 'splody', set: 'demolition', name: 'Splody Darts', icon: 'ArtifactSplodyDarts', desc: '+10% area damage', a: s => s.tag.area += 0.1 },
  { id: 'impact', set: 'demolition', name: 'Critical Impact', icon: 'ArtifactCriticalImpact', desc: '+10% area size', a: s => s.area += 0.1 },
  { id: 'econ', set: 'demolition', name: 'Explosive Economics', icon: 'ArtifactExplosiveEconomics', desc: '+10% gold from pops', a: s => s.gold += 0.1 },
  { id: 'blitz', set: 'demolition', name: 'Blitzing Barrage Emitter', icon: 'ArtifactBlitzingApeBarrageEmitter', desc: '+8% attack speed', a: s => s.cdr += 0.08 },
  { id: 'punch', set: 'frostfire', name: 'Flaming Hot Puncharang', icon: 'ArtifactFlamingHotPuncharang', desc: '+15% fire damage', a: s => s.tag.fire += 0.15 },
  { id: 'frosted', set: 'frostfire', name: 'Frosted Tips', icon: 'ArtifactFrostedTips', desc: '+15% frost damage', a: s => s.tag.frost += 0.15 },
  { id: 'dazing', set: 'frostfire', name: 'Dazing Frostburn', icon: 'ArtifactDazingFrostburn', desc: '+10% effect duration', a: s => s.dur += 0.1 },
  { id: 'steel', set: 'frostfire', name: 'Cold Steel', icon: 'ArtifactColdSteel', desc: '+8% damage', a: s => s.dmg += 0.08 },
  { id: 'leader', set: 'commander', name: 'Charismatic Leader', icon: 'ArtifactCharismaticLeader', desc: '+10% summon damage', a: s => s.tag.summon += 0.1 },
  { id: 'squad', set: 'commander', name: 'Squadron, Together Strong', icon: 'ArtifactSquadronTogetherStrong', desc: '+8% attack speed', a: s => s.cdr += 0.08 },
  { id: 'general', set: 'commander', name: "General's Disposition", icon: 'ArtifactGeneralsDisposition', desc: '+10% damage', a: s => s.dmg += 0.1 },
  { id: 'consc', set: 'commander', name: 'Conscription', icon: 'ArtifactConscription', desc: '+12% trap damage', a: s => s.tag.trap += 0.12 },
  { id: 'change', set: 'fortune', name: 'Extra Change', icon: 'ArtifactExtraChange', desc: '+15% gold from pops', a: s => s.gold += 0.15 },
  { id: 'gourmand', set: 'fortune', name: 'Gourmand', icon: 'ArtifactGourmand', desc: '+0.6 health / sec', a: s => s.regen += 0.6 },
  { id: 'merchant', set: 'fortune', name: 'Merchant Token', icon: 'ArtifactMerchantToken', desc: 'Chests cost 10% less', a: s => s.chestDisc += 0.1 },
  { id: 'collector', set: 'fortune', name: 'Collector', icon: 'ArtifactCollector', desc: '+1.2m pickup range', a: s => s.magnet += 1.2 },
  { id: 'edge', set: 'heroic', name: 'Heroic Edge', icon: 'ArtifactHeroicEdge', desc: '+15% hero damage', a: s => s.heroDmg += 0.15 },
  { id: 'army', set: 'heroic', name: 'One Monkey Army', icon: 'ArtifactOneMonkeyArmy', desc: '+8% move speed', a: s => s.speed += 0.08 },
  { id: 'innate', set: 'heroic', name: 'Innate Ability', icon: 'ArtifactInnateAbility', desc: 'Hero ability cooldown -12%', a: s => s.abilCdr = (s.abilCdr || 0) + 0.12 },
  { id: 'unspoken', set: 'heroic', name: 'The Unspoken Heroes', icon: 'ArtifactTheUnspokenHeroes', desc: '+10% hero damage, +10 max health', a: (s, g) => { s.heroDmg += 0.1; s.maxhp += 10; g.player.hp += 10; } },
];
// boss essences: unique legendary relics dropped by each boss
const ESSENCE = {
  bloonarius: { id: 'e_bloonarius', name: 'Essence of Bloonarius', icon: 'ArtifactEssenceOfBloonarius', desc: '+50 max health', a: (s, g) => { s.maxhp += 50; g.player.hp += 50; } },
  lych: { id: 'e_lych', name: 'Essence of Lych', icon: 'ArtifactEssenceOfLych', desc: 'Heal 1 health every 10 pops', a: s => s.lifePop = (s.lifePop || 0) + 0.1 },
  vortex: { id: 'e_vortex', name: 'Essence of Vortex', icon: 'ArtifactEssenceOfVortex', desc: '+12% move speed, faster dash recharge', a: s => { s.speed += 0.12; s.dashCdr = (s.dashCdr || 0) + 0.3; } },
  dreadbloon: { id: 'e_dreadbloon', name: 'Essence of Dreadbloon', icon: 'ArtifactEssenceOfDreadbloon', desc: '+3 armor', a: s => s.armor += 3 },
  phayze: { id: 'e_phayze', name: 'Essence of Phayze', icon: 'ArtifactEssenceOfPhayze', desc: '+10% critical chance', a: s => s.crit += 0.1 },
  blastapopoulos: { id: 'e_blast', name: 'Essence of Blastapopoulos', icon: 'ArtifactEssenceOfBlastapopoulos', desc: '+25% fire damage, burns last longer', a: s => { s.tag.fire += 0.25; s.dur += 0.15; } },
};
function relicById(id) { return RELICS.find(r => r.id === id) || Object.values(ESSENCE).find(r => r.id === id); }
function dropRelic(x, y, id) {
  if (!id) {
    const own = new Set(G.relics), pool = RELICS.filter(r => !own.has(r.id));
    if (!pool.length) return;
    // lean towards sets you've already started so bonuses are reachable
    const started = new Set(G.relics.map(i => (relicById(i) || {}).set).filter(Boolean));
    const w = pool.map(r => started.has(r.set) ? 2.2 : 1), tot = w.reduce((a, b) => a + b, 0);
    let k = Math.random() * tot; id = pool[pool.length - 1].id; for (let i = 0; i < pool.length; i++) { k -= w[i]; if (k <= 0) { id = pool[i].id; break; } }
  }
  G.pickups.push({ kind: 'relic', id, x, y, t: 0 });
}
function setCount(set) { return G.relics.filter(i => (relicById(i) || {}).set === set).length; }
function gainRelic(id) {
  const r = relicById(id); if (!r || G.relics.includes(id)) return;
  G.relics.push(id); r.a(G.stats, G);
  const S = r.set && RELIC_SETS[r.set], n = r.set ? setCount(r.set) : 0;
  toast(`RELIC: ${r.name} — ${r.desc}`, S ? S.color : '#ffd84a');
  play('LegendsArtifactExtract', { vol: 0.8 });
  if (S && n === 2) { S.a2(G.stats, G); setTimeout(() => G && toast(`${S.name} set (2): ${S.b2}`, S.color), 1400); }
  if (S && n === 4) { S.a4(G.stats, G); setTimeout(() => G && toast(`${S.name} set (4): ${S.b4}`, S.color), 1400); META.ach('fullset'); }
  if (G.relics.length >= 10) META.ach('relics10');
}
function drawRelics(u, yTop) {
  if (!G.relics || !G.relics.length) return yTop;
  const is = 30 * u, ig = 5 * u, per = 8, x0 = 18 * u, rows = Math.ceil(G.relics.length / per), y0 = yTop - rows * (is + ig) - 22 * u;
  text('RELICS', x0, y0 - 6 * u, 12 * u, '#cbbfa8');
  G.relics.forEach((id, i) => {
    const r = relicById(id), x = x0 + (i % per) * (is + ig), y = y0 + Math.floor(i / per) * (is + ig), S = r.set && RELIC_SETS[r.set];
    ctx.fillStyle = 'rgba(10,6,16,.75)'; roundRect(x, y, is, is, 6 * u); ctx.fill();
    ctx.strokeStyle = S ? S.color : '#ffb02e'; ctx.lineWidth = 2 * u; roundRect(x, y, is, is, 6 * u); ctx.stroke();
    const im = uiImg('relic/' + r.icon); if (im) ctx.drawImage(im, x + 2 * u, y + 2 * u, is - 4 * u, is - 4 * u);
  });
  // set progress
  const sets = Object.keys(RELIC_SETS).map(k => [k, setCount(k)]).filter(x => x[1]);
  sets.forEach(([k, n], i) => text(`${RELIC_SETS[k].name} ${n}/4`, x0 + i * 110 * u, y0 - 22 * u, 11 * u, RELIC_SETS[k].color));
  return y0 - 30 * u;
}

// ================================================================ Monkey Knowledge (permanent upgrades bought with Monkey Money)
const KNOWLEDGE = [
  { id: 'gold', name: 'Starting Cash', icon: 'btd_Coin', costs: [150, 350, 700], desc: l => `Start runs with $${[0, 100, 250, 500][l]}`, apply: (l, s, g) => { g.gold += [0, 100, 250, 500][l]; } },
  { id: 'reroll', name: 'Second Thoughts', icon: null, glyph: '⟳', costs: [200, 500], desc: l => `+${l} reroll per run`, apply: (l, s, g) => { g.rerolls += l; } },
  { id: 'banish', name: 'Cleansing', icon: null, glyph: '✕', costs: [300], desc: l => `+${l} banish per run`, apply: (l, s, g) => { g.banishes += l; } },
  { id: 'luck', name: 'Lucky Monkey', icon: null, glyph: '☘', costs: [250, 500, 900], desc: l => `+${l * 2} luck`, apply: (l, s) => { s.luck += l * 2; } },
  { id: 'hp', name: 'Thick Fur', icon: null, glyph: '❤', costs: [150, 300, 600], desc: l => `+${l * 8}% max health`, apply: (l, s) => { s.maxhp *= 1 + l * 0.08; } },
  { id: 'dmg', name: 'Sharp Minds', icon: null, glyph: '⚔', costs: [200, 450, 900], desc: l => `+${l * 5}% damage`, apply: (l, s) => { s.dmg += l * 0.05; } },
  { id: 'xp', name: 'Monkey Education', icon: null, glyph: '✧', costs: [150, 350, 700], desc: l => `+${l * 8}% soul gain`, apply: (l, s) => { s.xp += l * 0.08; } },
  { id: 'magnet', name: 'Soul Attraction', icon: null, glyph: '◉', costs: [120, 300], desc: l => `+${l * 0.8}m pickup range`, apply: (l, s) => { s.magnet += l * 0.8; } },
  { id: 'chest', name: 'Bargain Hunter', icon: null, glyph: '%', costs: [250, 600], desc: l => `Chests cost ${l * 8}% less`, apply: (l, s) => { s.chestDisc += l * 0.08; } },
  { id: 'relic', name: 'Relic Hunter', icon: null, glyph: '◆', costs: [400, 900], desc: l => `+${l * 50}% relic drop chance`, apply: (l, s) => { s.relicFind = 1 + l * 0.5; } },
  { id: 'ability', name: 'Heroic Discipline', icon: null, glyph: '⚡', costs: [300, 700], desc: l => `Hero ability cooldown -${l * 10}%`, apply: (l, s) => { s.abilCdr = (s.abilCdr || 0) + l * 0.1; } },
  { id: 'mm', name: 'Monkey Bank', icon: null, glyph: '$', costs: [300, 800], desc: l => `+${l * 15}% Monkey Money from runs`, apply: () => { } },
];
const kLv = id => (PROFILE.know && PROFILE.know[id]) || 0;

// ================================================================ heroes: three starters, the rest unlock by beating bosses
const STARTERS = ['quincy', 'gwen', 'striker'];
const UNLOCK_ORDER = ['obyn', 'churchill', 'benjamin', 'ezili', 'pat', 'adora', 'brickell', 'etienne', 'sauda', 'psi', 'geraldo', 'corvus', 'rosalia', 'silas'];
function heroUnlocked(id) {
  if (STARTERS.includes(id)) return true;
  if (PROFILE.unlocked && PROFILE.unlocked.includes(id)) return true;
  return SKINS.some(s => s.hero === id && PROFILE.owned.includes(s.key));   // anyone you already bought skins for stays unlocked
}
function nextUnlock() { return UNLOCK_ORDER.find(id => !heroUnlocked(id)); }
const UNLOCK_VO = { quincy: 'UnlockQuincy', gwen: 'UnlockGwen', obyn: 'UnlockObyn', rosalia: 'UnlockRosalia', churchill: 'UnlockChurchill', benjamin: 'UnlockBenjamin', pat: 'UnlockPat', ezili: 'UnlockEzili', adora: 'UnlockAdora', brickell: 'UnlockBrickell', etienne: 'UnlockEtienne', sauda: 'UnlockSauda', psi: 'UnlockPsi', corvus: 'UnlockCorvus', silas: 'UnlockSilas' };

// ================================================================ achievements
const ACH = [
  { id: 'pop10k', name: 'Pop Culture', desc: 'Pop 10,000 bloon layers in one run', mm: 300 },
  { id: 'nodash', name: 'Stand Your Ground', desc: 'Defeat a boss without dashing', mm: 250 },
  { id: 'boss1', name: 'Giant Slayer', desc: 'Defeat your first boss', mm: 100 },
  { id: 'loop2', name: 'Through the Portal', desc: 'Reach loop 2 in a run', mm: 200 },
  { id: 'loop4', name: 'Deep Dive', desc: 'Reach loop 4 in a run', mm: 500 },
  { id: 'lvl30', name: 'Well Educated', desc: 'Reach level 30', mm: 200 },
  { id: 'dmg1m', name: 'Megapopper', desc: 'Deal 1,000,000 damage in one run', mm: 300 },
  { id: 'cash5k', name: 'Monkey Business', desc: 'Earn $5,000 in one run', mm: 200 },
  { id: 'golden', name: 'Gold Rush', desc: 'Pop a Golden Bloon', mm: 100 },
  { id: 'paragon', name: 'Paragon of Virtue', desc: 'Create a Paragon', mm: 400 },
  { id: 'fullset', name: 'Collector', desc: 'Complete a 4-piece relic set', mm: 300 },
  { id: 'relics10', name: 'Hoarder', desc: 'Hold 10 relics at once', mm: 250 },
  { id: 'combo500', name: 'Chain Reaction', desc: 'Reach a 500 pop combo', mm: 200 },
  { id: 'survive20', name: 'Endurance', desc: 'Survive for 20 minutes', mm: 250 },
  { id: 'chaos3', name: 'Chaos Tamer', desc: 'Defeat a boss on Chaos III or higher', mm: 400 },
  { id: 'blimps100', name: 'Blimp Hunter', desc: 'Destroy 100 MOAB-class bloons (all runs)', mm: 300 },
  { id: 'abil20', name: 'Show-off', desc: 'Use your hero ability 20 times in one run', mm: 150 },
  { id: 'allheroes', name: 'Full Roster', desc: 'Unlock every hero', mm: 1000 },
];

// ================================================================ META facade used by game3d.js
const META = {
  // run start: Monkey Knowledge + per-run trackers
  start(stats, g) {
    for (const k of KNOWLEDGE) { const l = kLv(k.id); if (l) k.apply(l, stats, g); }
    g.player.hp = stats.maxhp;
    g.relics = []; g.combo = 0; g.comboT = 0; g.dashesUsed = 0; g.bossDash = 0; g.abilUses = 0;
  },
  tick(dt) {
    if (!G) return;
    G.comboT = (G.comboT || 0) - dt;
    if (G.combo >= 500) META.ach('combo500');
    if (G.t >= 1200) META.ach('survive20');
    if (G.level >= 30) META.ach('lvl30');
    if (G.pops >= 10000) META.ach('pop10k');
    if (G.dmgDealt >= 1e6) META.ach('dmg1m');
    if (G.goldEarned >= 5000) META.ach('cash5k');
    if (G.loop >= 1) META.ach('loop2');
    if (G.loop >= 3) META.ach('loop4');
  },
  pop(b) {
    comboPop();
    if (b.def.golden) META.ach('golden');
    if (G.stats.lifePop) { G.lifeAcc = (G.lifeAcc || 0) + G.stats.lifePop; if (G.lifeAcc >= 1) { const h = Math.floor(G.lifeAcc); G.lifeAcc -= h; G.player.hp = Math.min(G.stats.maxhp, G.player.hp + h); rs('hero').heal += h; } }
    if (b.def.moab) {
      PROFILE.blimps = (PROFILE.blimps || 0) + 1; if (PROFILE.blimps >= 100) META.ach('blimps100');
      if (Math.random() < 0.07 * (G.stats.relicFind || 1)) dropRelic(b.x, b.y);
    }
  },
  chest(x, y) { if (Math.random() < 0.3 * (G.stats.relicFind || 1)) dropRelic(x + rnd(-1, 1), y + rnd(-1, 1)); },
  bossKill(b) {
    const ess = ESSENCE[b.def.id];
    if (ess && !G.relics.includes(ess.id)) dropRelic(b.x + 1.5, b.y, ess.id);
    dropRelic(b.x - 1.5, b.y);
    META.ach('boss1');
    if (G.dashesUsed === b.dashAtSpawn) META.ach('nodash');
    if (G.chaosIdx >= 2) META.ach('chaos3');
    // hero unlock
    const nu = nextUnlock();
    if (nu) {
      PROFILE.unlocked = (PROFILE.unlocked || []).concat(nu); saveProfile();
      const ch = CHARS.find(c => c.id === nu);
      setTimeout(() => { if (!G) return; toast(`HERO UNLOCKED: ${ch.name}!`, '#7fd8ff'); play('UIHeroUnlock', { vol: 0.8 }); if (UNLOCK_VO[nu]) setTimeout(() => play(UNLOCK_VO[nu], { vol: 1, bus: 'vo' }), 700); }, 2500);
      if (!nextUnlock()) META.ach('allheroes');
    }
  },
  dash() { if (G) G.dashesUsed = (G.dashesUsed || 0) + 1; },
  ability() { if (G) { G.abilUses = (G.abilUses || 0) + 1; if (G.abilUses >= 20) META.ach('abil20'); } },
  mmMult() { return 1 + kLv('mm') * 0.15; },
  ach(id) {
    PROFILE.ach = PROFILE.ach || {};
    if (PROFILE.ach[id]) return;
    const a = ACH.find(x => x.id === id); if (!a) return;
    PROFILE.ach[id] = Date.now(); PROFILE.mm += a.mm; saveProfile();
    achPopup(a);
  },
};
function achPopup(a) {
  const el = document.createElement('div'); el.className = 'achpop';
  el.innerHTML = `<div class="at">🏆 ACHIEVEMENT</div><div class="an">${a.name}</div><div class="ad">${a.desc}</div><div class="am"><img src="assets/ui/heroes/mm.png">+${a.mm}</div>`;
  document.body.appendChild(el); play('QuestNotification', { vol: 0.7 });
  setTimeout(() => el.classList.add('out'), 3800); setTimeout(() => el.remove(), 4400);
}

// ================================================================ menu pages: Knowledge, Achievements, Settings
function openPage(id) { for (const p of ['knowpage', 'achpage', 'setpage']) show(p, p === id); play('UIClick01', { vol: 0.5 }); }
function renderKnowledge() {
  $('kmm').textContent = Math.floor(PROFILE.mm).toLocaleString();
  const box = $('klist'); box.innerHTML = '';
  for (const k of KNOWLEDGE) {
    const l = kLv(k.id), max = k.costs.length, cost = k.costs[l];
    const el = document.createElement('div'); el.className = 'knode' + (l >= max ? ' maxed' : '') + (cost && PROFILE.mm < cost ? ' cant' : '');
    el.innerHTML = `<div class="kg">${k.icon ? `<img src="assets/ui/${k.icon}.png">` : k.glyph}</div><div class="kt"><div class="kn">${k.name}</div><div class="kd">${l ? k.desc(l) : '—'}${l < max ? `<br><span>Next: ${k.desc(l + 1)}</span>` : ''}</div>
      <div class="kpips">${k.costs.map((_, i) => `<i class="${i < l ? 'on' : ''}"></i>`).join('')}</div></div>
      <button class="btn small">${l >= max ? 'MAXED' : `<img src="assets/ui/heroes/mm.png">${cost}`}</button>`;
    el.querySelector('button').onclick = () => {
      if (l >= max || PROFILE.mm < cost) { play('UIError02', { vol: 0.5 }); return; }
      PROFILE.mm -= cost; PROFILE.know = PROFILE.know || {}; PROFILE.know[k.id] = l + 1; saveProfile(); play('UpgradeParagonDartMonkey', { vol: 0.4 }); renderKnowledge(); buildMenu();
    };
    box.appendChild(el);
  }
}
function renderAch() {
  const have = PROFILE.ach || {}, n = ACH.filter(a => have[a.id]).length;
  $('achsum').textContent = `${n} / ${ACH.length} unlocked`;
  $('achlist').innerHTML = ACH.map(a => `<div class="arow${have[a.id] ? ' got' : ''}"><div class="ai">${have[a.id] ? '🏆' : '🔒'}</div><div><div class="an">${a.name}</div><div class="ad">${a.desc}</div></div><div class="am"><img src="assets/ui/heroes/mm.png">${a.mm}</div></div>`).join('');
}
let rebinding = null;
function renderSettings() {
  const tog = (id, label, desc) => `<div class="srow"><div><b>${label}</b><div class="sd">${desc}</div></div><button class="btn small tog${SETTINGS[id] ? ' on' : ''}" data-s="${id}">${SETTINGS[id] ? 'ON' : 'OFF'}</button></div>`;
  $('setlist').innerHTML = tog('shake', 'Screen shake', 'Camera shake on explosions and hits') + tog('cbLabels', 'Colourblind bloon labels', 'Shows a letter on nearby bloons (R, B, G, Y, P… plus c/r/f for camo, regrow, fortified)') + tog('dmgNumbers', 'Damage numbers', 'Floating damage numbers on hits') +
    `<h3>Controls</h3>` + Object.keys(DEFAULT_KEYS).map(a => `<div class="srow"><div><b>${KEY_LABEL[a]}</b></div><button class="btn small key${rebinding === a ? ' on' : ''}" data-k="${a}">${rebinding === a ? 'Press a key…' : keyName(SETTINGS.keys[a])}</button></div>`).join('') +
    `<div class="srow"><div class="sd">Gamepad: left stick move · A/RB dash · X/LB ability · B portal · Y aim · Start pause. Touch: drag on the left to move, buttons on the right.</div><button class="btn small" id="keyreset">Reset keys</button></div>`;
  $('setlist').querySelectorAll('[data-s]').forEach(b => b.onclick = () => { SETTINGS[b.dataset.s] = !SETTINGS[b.dataset.s]; saveSettings(); renderSettings(); play('UIClick01', { vol: 0.4 }); });
  $('setlist').querySelectorAll('[data-k]').forEach(b => b.onclick = () => { rebinding = b.dataset.k; renderSettings(); });
  $('keyreset').onclick = () => { SETTINGS.keys = Object.assign({}, DEFAULT_KEYS); saveSettings(); renderSettings(); };
}
addEventListener('keydown', e => {
  if (!rebinding) return;
  e.preventDefault(); e.stopImmediatePropagation();
  for (const a in SETTINGS.keys) if (SETTINGS.keys[a] === e.code) SETTINGS.keys[a] = SETTINGS.keys[rebinding];   // swap clashes
  SETTINGS.keys[rebinding] = e.code; rebinding = null; saveSettings(); renderSettings();
}, true);
$('knowbtn').onclick = () => { renderKnowledge(); openPage('knowpage'); };
$('achbtn').onclick = () => { renderAch(); openPage('achpage'); };
$('setbtn').onclick = () => { renderSettings(); openPage('setpage'); };
$('psetbtn').onclick = () => { renderSettings(); openPage('setpage'); };
for (const id of ['knowpage', 'achpage', 'setpage']) { $(id).onclick = e => { if (e.target.id === id) show(id, false); }; $(id).querySelector('.pclose').onclick = () => { rebinding = null; show(id, false); }; }
