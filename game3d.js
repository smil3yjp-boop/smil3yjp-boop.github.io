/* Bloonstone Survivors — Soulstone Survivors-style arena survival with Bloons TD 6 art.
   Personal fan project; art is extracted locally from the player's own game installs. */
'use strict';

// ---------------------------------------------------------------- utilities
const TAU = Math.PI * 2;
const rnd = (a = 1, b) => b === undefined ? Math.random() * a : a + Math.random() * (b - a);
const rint = (a, b) => Math.floor(rnd(a, b + 1));
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const dist2 = (a, b) => { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; };
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// ---------------------------------------------------------------- sprites
const SHEETS = (window.SPRITE_SHEETS || []).map(src => { const i = new Image(); i.src = src; return i; });
const SPRITES = window.SPRITES || {};
const IMAGES = {};
function img(name) {
  if (!IMAGES[name]) {
    const i = new Image();
    i.src = name.startsWith('ui/') ? 'assets/' + name + '.png' : /^ss\d+__/.test(name) ? 'assets/tex/' + name + '.jpg' : 'assets/' + name;
    IMAGES[name] = i;
  }
  return IMAGES[name];
}
const _sprCache = {};
// Resolve a logical sprite name against the atlas (exact, then case-insensitive)
function sprite(name) {
  if (name in _sprCache) return _sprCache[name];
  let s = SPRITES[name];
  if (!s) {
    const low = name.toLowerCase();
    const k = Object.keys(SPRITES).find(k => k.toLowerCase() === low);
    s = k ? SPRITES[k] : null;
  }
  return (_sprCache[name] = s || null);
}
// draw sprite centered at (x,y) fitting within `size` px (largest side)
function drawSprite(ctx, name, x, y, size, rot = 0, flip = false, alpha = 1) {
  const s = sprite(name);
  if (!s) return false;
  const sh = SHEETS[s[0]];
  if (!sh || !sh.complete) return false;
  const [, sx, sy, sw, sh2] = s;
  const k = size / Math.max(sw, sh2);
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(x, y);
  if (rot) ctx.rotate(rot);
  if (flip) ctx.scale(-1, 1);
  ctx.drawImage(sh, sx, sy, sw, sh2, -sw * k / 2, -sh2 * k / 2, sw * k, sh2 * k);
  ctx.restore();
  return true;
}
function spriteToCanvas(c, name, fallbackColor = '#888') {
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  if (!drawSprite(g, name, c.width / 2, c.height / 2, Math.min(c.width, c.height) * 0.92)) {
    g.fillStyle = fallbackColor; g.beginPath(); g.arc(c.width / 2, c.height / 2, c.width * 0.35, 0, TAU); g.fill();
  }
}

// ---------------------------------------------------------------- audio (procedural pops)
let AC = null;
function audio() { if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { } } return AC; }
let popBudget = 0;
// real BTD6 sound effects (decoded from the game's FSB5 banks, see assets/btd_audio.js)
const SND = { buf: {}, loading: false, last: {}, master: null, vo: null };
function sndInit() {
  const ac = audio(); if (!ac || SND.loading || !window.BTD_AUDIO) return;
  SND.loading = true;
  SND.master = ac.createGain(); SND.master.connect(ac.destination);
  SND.sfxG = ac.createGain(); SND.sfxG.connect(SND.master);
  SND.voG = ac.createGain(); SND.voG.connect(SND.master);
  applyAudio();
  for (const [k, uri] of Object.entries(window.BTD_AUDIO)) {
    fetch(uri).then(r => r.arrayBuffer()).then(b => ac.decodeAudioData(b)).then(d => { SND.buf[k] = d; }).catch(() => { });
  }
}
// play(name | [names] | 'Prefix*'), with per-key rate limit
function play(name, { vol = 1, gap = 0.05, rate = 1, key, bus } = {}) {
  const ac = audio(); if (!ac || !SND.master) return null;
  let n = name;
  if (Array.isArray(n)) n = pick(n);
  else if (n.endsWith('*')) { const pre = n.slice(0, -1), opts = Object.keys(SND.buf).filter(k => k.startsWith(pre)); if (!opts.length) return null; n = pick(opts); }
  const b = SND.buf[n]; if (!b) return null;
  const kk = key || name, now = ac.currentTime;
  if (SND.last[kk] && now - SND.last[kk] < gap) return null;
  SND.last[kk] = now;
  const src = ac.createBufferSource(), g = ac.createGain();
  src.buffer = b; src.playbackRate.value = rate * (0.94 + Math.random() * 0.12); g.gain.value = vol;
  src.connect(g).connect(bus === 'vo' ? SND.voG : SND.sfxG); src.start();
  return src;
}
// hero voice line (one at a time)
const VO = { Quincy: 'Quincy', Gwendolin: 'Gwen', StrikerJones: 'Jones', Obyn: 'Obyn', Rosalia: 'Rosalia', Churchill: 'Churchill', Benjamin: 'Benjamin', PatFusty: 'Pat', Ezili: 'Ezili', Adora: 'Adora', Brickell: 'Brickell', Etienne: 'Etienne', Sauda: 'Sauda', Psi: 'Psi', Geraldo: 'Geraldo', Corvus: 'Corvus', Silas: 'Silas' };
function voice(kind) {
  if (!G || !G.ch.vo) return;
  const ac = audio(); if (!ac) return;
  if (SND.vo && SND.voEnd > ac.currentTime) return;
  const s = play(kind + G.ch.vo + '*', { vol: 1.4, gap: 0, key: 'vo', bus: 'vo' });
  if (s) { SND.vo = s; SND.voEnd = ac.currentTime + s.buffer.duration; }
}
function sfxPop(big = false) {
  if (popBudget > 8) return; popBudget++;
  if (big) play(['MoabDestroyed01', 'MoabDestroyed02', 'MoabDestroyed03'], { vol: 0.9, gap: 0.08 });
  else play('Pop0*', { vol: 0.45, gap: 0.025, key: 'pop' });
}
function sfxHit(b) {
  if (b.def && b.def.golden) { play('HitGolden0*', { vol: 0.5, gap: 0.06, key: 'hitgold' }); return; }
  if (b.isBoss || (b.def && b.def.moab)) play('HitMoab0*', { vol: 0.5, gap: 0.07, key: 'hitmoab' });
  else if (b.type === 'ceramic') play('HitCeramic0*', { vol: 0.35, gap: 0.06, key: 'hitcer' });
  else if (b.type === 'lead') play('HitMetal0*', { vol: 0.35, gap: 0.08, key: 'hitmetal' });
}
function sfxTone(f0, f1, dur, vol = 0.12, type = 'sine') {
  const ac = audio(); if (!ac) return;
  const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur + 0.05);
}

// ---------------------------------------------------------------- data: bloons
// hp is per-layer health; children spawn on pop. speed in units/sec. r = radius (units)
const BLOONS = {
  red:     { spr: 'Red',     hp: 3,    sm: 0.5, r: 0.45, dmg: 4,  xp: 1, color: '#e8302c', kids: [] },
  blue:    { spr: 'Blue',    hp: 4,    sm: 0.58, r: 0.48, dmg: 5,  xp: 1, color: '#2f7ff0', kids: [['red', 1]] },
  green:   { spr: 'Green',   hp: 5,    sm: 0.68, r: 0.5,  dmg: 6,  xp: 1, color: '#5bc236', kids: [['blue', 1]] },
  yellow:  { spr: 'Yellow',  hp: 6,    sm: 0.82, r: 0.52, dmg: 7,  xp: 1, color: '#f6e030', kids: [['green', 1]] },
  pink:    { spr: 'Pink',    hp: 7,    sm: 1.08, r: 0.52, dmg: 8,  xp: 1, color: '#f57ab4', kids: [['yellow', 1]] },
  black:   { spr: 'Black',   hp: 10,   sm: 0.68, r: 0.38, dmg: 9,  xp: 2, color: '#222',    kids: [['pink', 2]] },
  white:   { spr: 'White',   hp: 10,   sm: 0.68, r: 0.38, dmg: 9,  xp: 2, color: '#eee',    kids: [['pink', 2]], frostImmune: true },
  purple:  { spr: 'Purple',  hp: 12,   sm: 0.95, r: 0.52, dmg: 10, xp: 2, color: '#9b3fd6', kids: [['pink', 2]], resist: { fire: 0.4, lightning: 0.4 } },
  zebra:   { spr: 'Zebra',   hp: 14,   sm: 0.82, r: 0.55, dmg: 11, xp: 2, color: '#ddd',    kids: [['black', 1], ['white', 1]], frostImmune: true },
  lead:    { spr: 'Lead',    hp: 22,   sm: 0.68, r: 0.55, dmg: 12, xp: 3, color: '#6d7a85', kids: [['black', 2]], resist: { proj: 0.5 } },
  rainbow: { spr: 'Rainbow', hp: 22,   sm: 0.82, r: 0.58, dmg: 13, xp: 3, color: '#ff9',    kids: [['zebra', 2]] },
  ceramic: { spr: 'Ceramic', hp: 70,   sm: 0.82, r: 0.62, dmg: 16, xp: 5, color: '#b5651d', kids: [['rainbow', 2]] },
  moab:    { spr: 'MoabIcon',    hp: 700,  spd: 1.9, r: 1.6,  dmg: 25, xp: 30, color: '#3a8ee6', kids: [['ceramic', 4]], moab: true, elite: true },
  bfb:     { spr: 'BfbIcon',     hp: 2600, spd: 1.45, r: 2.0, dmg: 40, xp: 80, color: '#d33',   kids: [['moab', 4]], moab: true, elite: true },
  ddt:     { spr: 'DdtIcon',     hp: 900,  spd: 4.2, r: 1.3,  dmg: 30, xp: 60, color: '#333',    kids: [['ceramic', 6]], moab: true, elite: true },
  golden:  { spr: 'GoldenBloon', hp: 140, spd: 5.2, r: 0.58, dmg: 0, xp: 50, color: '#ffd700', kids: [], golden: true, frostImmune: true },
  rock:    { spr: 'DreadRockBloonStandard', ds: 'DreadRockBloonStandardDS', hp: 360, spd: 2.6, r: 0.8, dmg: 18, xp: 8, color: '#c08030', kids: [], resist: { proj: 0.7 }, frostImmune: true },
  magma:   { spr: 'DreadRockBloonElite', ds: 'DreadRockBloonEliteDS', hp: 300, spd: 3.0, r: 0.8, dmg: 20, xp: 8, color: '#ff6a30', kids: [], resist: { fire: 0.2 }, magma: true },
  lychmini:{ spr: 'MoabIcon', rig: 'b_lychmini', hp: 1400, spd: 2.3, r: 1.3, dmg: 22, xp: 40, color: '#7a2fd0', kids: [], moab: true },
  zomg:    { spr: 'ZomgIcon',    hp: 9000, spd: 1.1, r: 2.6,  dmg: 60, xp: 200, color: '#2c2',   kids: [['bfb', 2]], moab: true, elite: true },
};
// bloon speed as a fraction of the hero's base run speed (red is half as fast as you, pink slightly faster)
const bloonSpd = (def) => def.sm ? def.sm * (G && G.ch ? G.ch.spd : 6.5) : def.spd;
// BTD6 bloon properties: camo (only seen up close), regrow (grows back a layer when left alone), fortified (lead/ceramic/blimps: double health)
const CAN_FORT = { lead: 1, ceramic: 1, moab: 1, bfb: 1, zomg: 1, ddt: 1 };
const CAMO_SIGHT = 7, REGROW_T = 2.5, DDT_AURA = 3.4;
const BLOON_ORDER = ['red', 'blue', 'green', 'yellow', 'pink', 'black', 'white', 'purple', 'zebra', 'lead', 'rainbow', 'ceramic'];
const UNLOCK_T = { red: 0, blue: 15, green: 40, yellow: 70, pink: 100, black: 135, white: 150, purple: 185, zebra: 210, lead: 235, rainbow: 270, ceramic: 320 };
const COST = { red: 1, blue: 2, green: 3, yellow: 4, pink: 5, black: 11, white: 11, purple: 11, zebra: 23, lead: 23, rainbow: 47, ceramic: 104 };

const BOSS_SFX = { bloonarius: ['BossBloonariusSpawn', 'BossBloonariusDeath'], lych: ['BossLychSpawn', 'BossLychDeath'], vortex: ['VortexSpawn', 'VortexDeath'], dreadbloon: ['BossDreadBloonArmourBreak', 'BossDreadBloonDeath'], phayze: ['BossPhayzeSpawn', 'BossPhayzeDeath'], blastapopoulos: ['BossBlastapopoulosSpawn', 'BossBlastapopoulosDeath'] };
const BOSSES = [
  { id: 'bloonarius', name: 'BLOONARIUS', title: 'The Inflator', model: 'bloonarius', hp: 30000, r: 3.4, spd: 1.2, color: '#4bd34b', ability: 'spawn' },
  { id: 'lych', name: 'LYCH', title: 'Soul Drinker', model: 'lych', hp: 27000, r: 3.2, spd: 1.5, color: '#7a2fd0', ability: 'spawn' },
  { id: 'vortex', name: 'VORTEX', title: 'Deadly Master of Air', model: 'vortex', hp: 23000, r: 3.0, spd: 2.1, color: '#9fd6ff', ability: 'charge' },
  { id: 'dreadbloon', name: 'DREADBLOON', title: 'The Armored Behemoth', model: 'dreadbloon', hp: 34000, r: 3.3, spd: 1.0, color: '#d0542a', ability: 'rocks' },
  { id: 'phayze', name: 'PHAYZE', title: 'Reality Warper', model: 'phayze', hp: 26000, r: 3.0, spd: 1.8, color: '#33ddff', ability: 'charge' },
  { id: 'blastapopoulos', name: 'BLASTAPOPOULOS', title: 'Demon of the Core', model: 'blastapopoulos', hp: 30000, r: 3.3, spd: 1.3, color: '#ff5a1f', ability: 'rocks' },
];

// ---------------------------------------------------------------- data: characters
const CHARS = [
  { id: 'quincy', name: 'Quincy', spr: ['QuincyIcon'], model: 'h_Quincy', vo: 'Quincy', skill: 'dart', hp: 110, spd: 6.6, desc: 'Master archer. +1 pierce, +15% projectile damage.', bonus: { pierce: 1 }, tagBonus: { proj: 0.15 } },
  { id: 'gwen', name: 'Gwendolin', spr: ['GwendolinIcon'], model: 'h_Gwendolin', vo: 'Gwen', skill: 'fire', hp: 105, spd: 6.6, desc: 'Pyromaniac. +25% fire damage.', bonus: {}, tagBonus: { fire: 0.25 } },
  { id: 'striker', name: 'Striker Jones', spr: ['StrikerJonesIcon'], model: 'h_StrikerJones', vo: 'Jones', skill: 'mortar', hp: 120, spd: 6.2, desc: 'Artillery commander. +20% area damage.', bonus: { area: 0.1 }, tagBonus: { area: 0.2 } },
  { id: 'obyn', name: 'Obyn Greenfoot', spr: ['ObynGreenFootIcon'], model: 'h_Obyn', vo: 'Obyn', skill: 'spike', hp: 110, spd: 6.4, desc: 'Forest guardian. +20% trap damage.', bonus: {}, tagBonus: { trap: 0.2 } },
  { id: 'rosalia', name: 'Rosalia', spr: ['RosaliaIcon'], model: 'h_Rosalia', vo: 'Rosalia', skill: 'dartling', hp: 105, spd: 6.8, desc: 'Jetpack engineer. +10% attack speed.', bonus: { cdr: 0.1 }, tagBonus: { proj: 0.1 } },
  { id: 'churchill', name: 'Captain Churchill', spr: ['CaptainChurchillIcon'], model: 'h_Churchill', vo: 'Churchill', skill: 'bomb', hp: 150, spd: 5.6, desc: 'Tank commander. +2 armor, +15% area.', bonus: { armor: 2, area: 0.15 } },
  { id: 'benjamin', name: 'Benjamin', spr: ['BenjaminIcon'], model: 'h_Benjamin', vo: 'Benjamin', skill: 'sentry', hp: 95, spd: 6.4, desc: 'Hacker. +40% gold from pops.', bonus: { gold: 0.4 }, tagBonus: { summon: 0.1 } },
  { id: 'pat', name: 'Pat Fusty', spr: ['PatFustyIcon'], model: 'h_PatFusty', vo: 'Pat', skill: 'tack', hp: 170, spd: 5.8, desc: 'Big brawler. +3 armor, huge health.', bonus: { armor: 3 } },
  { id: 'ezili', name: 'Ezili', spr: ['EziliIcon'], model: 'h_Ezili', vo: 'Ezili', skill: 'glue', hp: 100, spd: 6.4, desc: 'Voodoo hexer. +25% effect duration.', bonus: { dur: 0.25 }, tagBonus: { area: 0.1 } },
  { id: 'adora', name: 'Adora', spr: ['AdoraIcon'], model: 'h_Adora', vo: 'Adora', skill: 'plasma', hp: 100, spd: 6.8, desc: 'Sun goddess. +15% damage.', bonus: { dmg: 0.15 } },
  { id: 'brickell', name: 'Admiral Brickell', spr: ['AdmiralBrickellIcon'], model: 'h_Brickell', vo: 'Brickell', skill: 'sub', hp: 110, spd: 6.4, desc: 'Naval admiral. +10% attack speed.', bonus: { cdr: 0.1 } },
  { id: 'etienne', name: 'Etienne', spr: ['EtienneIcon'], model: 'h_Etienne', vo: 'Etienne', skill: 'heli', hp: 100, spd: 6.6, desc: 'Drone operator. +25% summon damage.', bonus: {}, tagBonus: { summon: 0.25 } },
  { id: 'sauda', name: 'Sauda', spr: ['SaudaIcon'], model: 'h_Sauda', vo: 'Sauda', skill: 'boomer', hp: 115, spd: 7.0, desc: 'Swordmaster. +10% crit chance.', bonus: { crit: 0.1 } },
  { id: 'psi', name: 'Psi', spr: ['PsiIcon'], model: 'h_Psi', vo: 'Psi', skill: 'sniper', hp: 95, spd: 6.6, desc: 'Psionic. +40% crit damage.', bonus: { critMult: 0.4 } },
  { id: 'geraldo', name: 'Geraldo', spr: ['GeraldoIcon'], model: 'h_Geraldo', vo: 'Geraldo', skill: 'desperado', hp: 110, spd: 6.4, desc: 'Mystic shopkeeper. Chests 20% cheaper.', bonus: { chestDisc: 0.2 } },
  { id: 'corvus', name: 'Corvus', spr: ['CorvusIcon'], model: 'h_Corvus', vo: 'Corvus', skill: 'lightning', hp: 100, spd: 6.4, desc: 'Dark spellcaster. +1 lightning chain.', bonus: {}, chainBonus: 1 },
  { id: 'silas', name: 'Silas', spr: ['SilasIcon'], model: 'h_Silas', vo: 'Silas', skill: 'frost', hp: 110, spd: 6.4, desc: 'Ice wielder. +25% frost damage.', bonus: { dur: 0.15 }, tagBonus: { frost: 0.25 } },
];

// ---------------------------------------------------------------- hero signature attacks
const HERO_ATK = {
  quincy:    { name: "Quincy's Bow", type: 'proj', tags: ['proj'], cd: 0.7, dmg: 6, kind: 'bolt', speed: 28, pierce: 3, spread: 0.12, desc: 'Fires piercing arrows.' },
  gwen:      { name: 'Firestorm Flames', type: 'cone', tags: ['area', 'fire'], cd: 0.14, dmg: 1.3, range: 5.2, desc: 'Sprays a short-range jet of fire.' },
  striker:   { name: 'Artillery Shells', type: 'proj', tags: ['proj', 'area'], cd: 1.1, dmg: 10, kind: 'bomb', speed: 18, explode: 2.0, desc: 'Lobs explosive shells.' },
  obyn:      { name: 'Nature Bolts', type: 'proj', tags: ['proj'], cd: 0.8, dmg: 6, kind: 'orb', color: '#7dff6a', speed: 16, homing: 8, pierce: 2, desc: 'Homing bolts of nature magic.' },
  rosalia:   { name: 'Laser Blaster', type: 'beam', tags: ['proj'], cd: 0.55, dmg: 7, color: '#ff4040', range: 16, desc: 'Instant laser blasts.' },
  churchill: { name: 'Tank Shells', type: 'proj', tags: ['proj', 'area'], cd: 1.2, dmg: 14, kind: 'bomb', speed: 22, explode: 2.4, desc: 'Heavy explosive tank shells.' },
  benjamin:  { name: 'Code Bolts', type: 'proj', tags: ['proj'], cd: 0.45, dmg: 4, kind: 'orb', color: '#40ff80', speed: 24, pierce: 1, desc: 'Rapid streams of hostile code.' },
  pat:       { name: 'Big Slap', type: 'melee', tags: ['area'], cd: 0.9, dmg: 14, range: 2.8, arc: 1.7, stun: 0.4, desc: 'Massive close-range slaps that stun.' },
  ezili:     { name: 'Hex Bolts', type: 'proj', tags: ['proj'], cd: 0.75, dmg: 5, kind: 'orb', color: '#c040ff', speed: 18, pierce: 2, burn: 2.5, desc: 'Cursed bolts that keep damaging.' },
  adora:     { name: 'Ball of Light', type: 'proj', tags: ['proj'], cd: 0.6, dmg: 7, kind: 'sun', speed: 22, pierce: 4, desc: 'Radiant orbs that burn through bloons.' },
  brickell:  { name: 'Pistol Shots', type: 'proj', tags: ['proj'], cd: 0.35, dmg: 4, kind: 'bullet', speed: 34, pierce: 1, spread: 0.08, desc: 'Quick-fire pistol rounds.' },
  etienne:   { name: 'Drone Darts', type: 'proj', tags: ['proj'], cd: 0.4, dmg: 3.5, kind: 'dart', speed: 26, pierce: 2, drones: true, desc: 'His drones pepper bloons with darts.' },
  sauda:     { name: 'Blade Slashes', type: 'melee', tags: ['area'], cd: 0.45, dmg: 7, range: 2.4, arc: 2.2, desc: 'Lightning-fast sword slashes.' },
  psi:       { name: 'Psychic Focus', type: 'psi', tags: ['area'], cd: 0.9, dmg: 12, aoe: 1.4, color: '#c080ff', desc: 'Crushes bloons with her mind.' },
  geraldo:   { name: 'Shooty Revolver', type: 'proj', tags: ['proj'], cd: 0.65, dmg: 9, kind: 'bullet', speed: 36, pierce: 2, desc: 'Hard-hitting revolver shots.' },
  corvus:    { name: 'Spirit Spear', type: 'proj', tags: ['proj'], cd: 0.8, dmg: 9, kind: 'orb', color: '#ff3050', speed: 24, pierce: 5, desc: 'Dark spears that skewer lines of bloons.' },
  silas:     { name: 'Ice Shards', type: 'proj', tags: ['proj', 'frost'], cd: 0.5, dmg: 4.5, kind: 'orb', color: '#a8e8ff', speed: 22, pierce: 2, slow: 1.5, desc: 'Freezing shards that slow bloons.' },
};
function heroMelee() { return G && HERO_ATK[G.ch.id].type === 'melee'; }

// ---------------------------------------------------------------- data: skills
// Each skill: tags, icon sprite, base cooldown, cast(sk) + level descriptions (lv2..lv7)
const MAXLV = 7;
// tower paths (choose at levels 3 and 5): display names per path [Top, Middle, Bottom] x tiers [3,4,5], plus their BTD6 upgrade icons
const PATHS = {"dart": [["Spike-o-pult", "Juggernaut", "Ultra-Juggernaut"], ["Triple Shot", "Super Monkey Fan Club", "Plasma Monkey Fan Club"], ["Crossbow", "Sharp Shooter", "Crossbow Master"]], "boomer": [["Glaive Ricochet", "M.O.A.R. Glaives", "Glaive Lord"], ["Bionic Boomerang", "Turbo Charge", "Perma Charge"], ["Kylie Boomerang", "MOAB Press", "MOAB Domination"]], "bomb": [["Really Big Bombs", "Bloon Impact", "Bloon Crush"], ["Cluster Bombs", "Recursive Cluster", "Bomb Blitz"], ["MOAB Mauler", "MOAB Assassin", "MOAB Eliminator"]], "tack": [["Hot Shots", "Ring of Fire", "Inferno Ring"], ["Blade Shooter", "Blade Maelstrom", "Super Maelstrom"], ["Tack Sprayer", "Overdrive", "The Tack Zone"]], "frost": [["Ice Shards", "Embrittlement", "Super Brittle"], ["Arctic Wind", "Snowstorm", "Absolute Zero"], ["Cryo Cannon", "Icicles", "Icicle Impale"]], "glue": [["Bloon Dissolver", "Bloon Liquefier", "The Bloon Solver"], ["Glue Splatter", "Glue Hose", "Glue Storm"], ["MOAB Glue", "Relentless Glue", "Super Glue"]], "sniper": [["Deadly Precision", "Maim MOAB", "Cripple MOAB"], ["Bouncing Bullet", "Supply Drop", "Elite Sniper"], ["Semi-Automatic", "Full Auto Rifle", "Elite Defender"]], "shuriken": [["Double Shot", "Bloonjitsu", "Grandmaster Ninja"], ["Shinobi Tactics", "Bloon Sabotage", "Grand Saboteur"], ["Flash Bomb", "Sticky Bomb", "Master Bomber"]], "fire": [["Arcane Mastery", "Arcane Spike", "Archmage"], ["Dragon's Breath", "Summon Phoenix", "Wizard Lord Phoenix"], ["Shimmer", "Necromancer", "Prince of Darkness"]], "lightning": [["Druid of the Storm", "Ball Lightning", "Superstorm"], ["Druid of the Jungle", "Jungle's Bounty", "Spirit of the Forest"], ["Druid of Wrath", "Poplust", "Avatar of Wrath"]], "spike": [["Spiked Balls", "Spiked Mines", "Super Mines"], ["MOAB SHREDR", "Spike Storm", "Carpet of Spikes"], ["Long Life Spikes", "Deadly Spikes", "Perma-Spike"]], "mortar": [["Shell Shock", "The Big One", "The Biggest One"], ["Heavy Shells", "Artillery Battery", "Pop and Awe"], ["Signal Flare", "Shattering Shells", "Blooncineration"]], "heli": [["Razor Rotors", "Apache Dartship", "Apache Prime"], ["Downdraft", "Support Chinook", "Special Poperations"], ["MOAB Shove", "Comanche Defense", "Comanche Commander"]], "sentry": [["Sprockets", "Sentry Expert", "Sentry Champion"], ["Cleansing Foam", "Overclock", "Ultraboost"], ["Double Gun", "Bloon Trap", "XXXL Trap"]], "plasma": [["Sun Avatar", "Sun Temple", "True Sun God"], ["Robo Monkey", "Tech Terror", "The Anti-Bloon"], ["Dark Knight", "Dark Champion", "Legend of the Night"]], "brew": [["Berserker Brew", "Stronger Stimulant", "Permanent Brew"], ["Unstable Concoction", "Transforming Tonic", "Total Transformation"], ["Lead to Gold", "Rubber to Gold", "Bloon Master Alchemist"]], "farm": [["Banana Plantation", "Banana Research Facility", "Banana Central"], ["Monkey Bank", "IMF Loan", "Monkey-Nomics"], ["Marketplace", "Central Market", "Monkey Wall Street"]], "sub": [["Submerge and Support", "Bloontonium Reactor", "Energizer"], ["Ballistic Missile", "First Strike Capability", "Pre-emptive Strike"], ["Triple Guns", "Armor Piercing Darts", "Sub Commander"]], "buccaneer": [["Destroyer", "Aircraft Carrier", "Carrier Flagship"], ["Cannon Ship", "Monkey Pirates", "Pirate Lord"], ["Merchantman", "Favored Trades", "Trade Empire"]], "ace": [["Fighter Plane", "Operation: Dart Storm", "Sky Shredder"], ["Bomber Ace", "Ground Zero", "Tsar Bomba"], ["Neva-Miss Targeting", "Spectre", "Flying Fortress"]], "dartling": [["Laser Cannon", "Plasma Accelerator", "Ray of Doom"], ["Hydra Rocket Pods", "Rocket Storm", "M.A.D"], ["Buckshot", "Bloon Area Denial System", "Bloon Exclusion Zone"]], "desperado": [["Desperado 3-0-0", "Desperado 4-0-0", "Desperado 5-0-0"], ["Desperado 0-3-0", "Desperado 0-4-0", "Desperado 0-5-0"], ["Desperado 0-0-3", "Desperado 0-0-4", "Desperado 0-0-5"]], "mermonkey": [["Mermonkey 3-0-0", "Mermonkey 4-0-0", "Mermonkey 5-0-0"], ["Mermonkey 0-3-0", "Mermonkey 0-4-0", "Mermonkey 0-5-0"], ["Mermonkey 0-0-3", "Mermonkey 0-0-4", "Mermonkey 0-0-5"]], "village": [["Primary Training", "Primary Mentoring", "Primary Expertise"], ["Monkey Intelligence Bureau", "Call to Arms", "Homeland Defense"], ["Monkey Town", "Monkey City", "Monkeyopolis"]]};
const PATH_ICON = {"dart_T3": "Spike-o-pultUpgradeIcon", "dart_T4": "JuggernautUpgradeIcon", "dart_T5": "UltraJuggernautUpgradeIcon", "dart_M3": "TripleShotUpgradeIcon", "dart_M4": "SuperMonkeyFanClubUpgradeIcon", "dart_M5": "PlasmaMonkeyFanClubUpgradeIcon", "dart_B3": "CrossBowUpgradeIcon", "dart_B4": "SharpShooterUpgradeIcon", "dart_B5": "CrossBowMasterUpgradeIcon", "boomer_T3": "GlaiveRicochetUpgradeIcon", "boomer_T4": "MoarGlaivesUpgradeIcon", "boomer_T5": "GlaiveLordUpgradeIcon", "boomer_M3": "BionicBoomerangUpgradeIcon", "boomer_M4": "TurbochargeUpgradeIcon", "boomer_M5": "PermaChargeUpgradeIcon", "boomer_B3": "KylieBoomerangUpgradeIcon", "boomer_B4": "MoabPressUpgradeIcon", "boomer_B5": "MoabDominationUpgradeIcon", "bomb_T3": "ReallyBigBombsUpgradeIcon", "bomb_T4": "BloonImpactUpgradeIcon", "bomb_T5": "BloonCrushUpgradeIcon", "bomb_M3": "ClusterBombsUpgradeIcon", "bomb_M4": "RecursiveClusterUpgradeIcon", "bomb_M5": "BombBlitzUpgradeIcon", "bomb_B3": "MoabMaulerUpgradeIcon", "bomb_B4": "MoabAssassinUpgradeIcon", "bomb_B5": "MoabEliminatorUpgradeIcon", "tack_T3": "HotShotsUpgradeIcon", "tack_T4": "RingOfFireUpgradeIcon", "tack_T5": "InfernoRingUpgradeIcon", "tack_M3": "BladeShooterUpgradeIcon", "tack_M4": "BladeMaelstromUpgradeIcon", "tack_M5": "SuperMaelstromUpgradeIcon", "tack_B3": "TackSprayerUpgradeIcon", "tack_B4": "OverdriveUpgradeIcon", "tack_B5": "TheTackZoneUpgradeIcon", "frost_T3": "IceShardsUpgradeIcon", "frost_T4": "EmbrittlementUpgradeIcon", "frost_T5": "SuperBrittleUpgradeIcon", "frost_M3": "ArcticWindUpgradeIcon", "frost_M4": "SnowstormUpgradeIcon", "frost_M5": "AbsoluteZeroUpgradeIcon", "frost_B3": "CryoCannonUpgradeIcon", "frost_B4": "IciclesUpgradeIcon", "frost_B5": "IcicleImpaleUpgradeIcon", "glue_T3": "BloonDissolverUpgradeIcon", "glue_T4": "BloonLiquefierUpgradeIcon", "glue_T5": "TheBloonSolverUpgradeIcon", "glue_M3": "GlueSplatterUpgradeIcon", "glue_M4": "GlueHoseUpgradeIcon", "glue_M5": "GlueStormUpgradeIcon", "glue_B3": "MoabGlueUpgradeIcon", "glue_B4": "RelentlessGlueUpgradeIcon", "glue_B5": "SuperGlueUpgradeIcon", "sniper_T3": "DeadlyPrecisionUpgradeIcon", "sniper_T4": "MaimMoabUpgradeIcon", "sniper_T5": "CrippleMoabUpgradeIcon", "sniper_M3": "BouncingBulletUpgradeIcon", "sniper_M4": "CashDropUpgradeIcon", "sniper_M5": "EliteSniperUpgradeIcon", "sniper_B3": "SemiAutomaticUpgradeIcon", "sniper_B4": "FullAutoRifleUpgradeIcon", "sniper_B5": "EliteDefenderUpgradeIcon", "shuriken_T3": "DoubleShotUpgradeIcon", "shuriken_T4": "BloonjitsuUpgradeIcon", "shuriken_T5": "GrandmasterNinjaUpgradeIcon", "shuriken_M3": "ShinobiTacticsUpgradeIcon", "shuriken_M4": "BloonSabotageUpgradeIcon", "shuriken_M5": "GrandSaboteurUpgradeIcon", "shuriken_B3": "FlashBombUpgradeIcon", "shuriken_B4": "StickyBombUpgradeIcon", "shuriken_B5": "MasterBomberUpgradeIcon", "fire_T3": "ArcaneMasteryUpgradeIcon", "fire_T4": "ArcaneSpikeUpgradeIcon", "fire_T5": "ArchmageUpgradeIcon", "fire_M3": "DragonsBreathUpgradeIcon", "fire_M4": "SummonPhoenixUpgradeIcon", "fire_M5": "WizardLordPhoenixUpgradeIcon", "fire_B3": "ShimmerUpgradeIcon", "fire_B4": "SoulbindUpgradeIcon", "fire_B5": "SoulbindUpgradeIcon", "lightning_T3": "DruidoftheStormUpgradeIcon", "lightning_T4": "BallLightningUpgradeIcon", "lightning_T5": "SuperStormUpgradeIcon", "lightning_M3": "DruidoftheJungleUpgradeIcon", "lightning_M4": "JunglesBountyUpgradeIcon", "lightning_M5": "SpiritoftheForestUpgradeIcon", "lightning_B3": "DruidofWrathUpgradeIcon", "lightning_B4": "PoplustUpgradeIcon", "lightning_B5": "AvatarofWrathUpgradeIcon", "spike_T3": "SpikedBallsUpgradeIcon", "spike_T4": "SpikedMinesUpgradeIcon", "spike_T5": "SuperMinesUpgradeIcon", "spike_M3": "MOABSHREDRUpgradeIcon", "spike_M4": "SpikeStormUpgradeIcon", "spike_M5": "CarpetOfSpikesUpgradeIcon", "spike_B3": "LongLifeSpikesUpgradeIcon", "spike_B4": "DeadlySpikesUpgradeIcon", "spike_B5": "PermaSpikeUpgradeIcon", "mortar_T3": "ShellShockUpgradeIcon", "mortar_T4": "TheBIgOneUpgradeIcon", "mortar_T5": "TheBIggestOneUpgradeIcon", "mortar_M3": "HeavyShellsUpgradeIcon", "mortar_M4": "ArtilleryBatteryUpgradeIcon", "mortar_M5": "PopandAweUpgradeIcon", "mortar_B3": "SignalFlareUpgradeIcon", "mortar_B4": "ShatteringShellsUpgradeIcon", "mortar_B5": "BlooncinerationUpgradeIcon", "heli_T3": "RazorRotorsUpgradeIcon", "heli_T4": "ApacheDartshipUpgradeIcon", "heli_T5": "ApachePrimeUpgradeIcon", "heli_M3": "DowndraftUpgradeIcon", "heli_M4": "SupportChinookUpgradeIcon", "heli_M5": "SpecialPoperationsUpgradeIcon", "heli_B3": "MOABShoveUpgradeIcon", "heli_B4": "ComancheDefenseUpgradeIcon", "heli_B5": "ComancheCommanderUpgradeIcon", "sentry_T3": "SprocketsUpgradeIcon", "sentry_T4": "SentryExpertUpgradeIcon", "sentry_T5": "SentryParagonUpgradeIcon", "sentry_M3": "CleansingFoamUpgradeIcon", "sentry_M4": "OverclockUpgradeIcon", "sentry_M5": "UltraboostUpgradeIcon", "sentry_B3": "DoubleGunUpgradeIcon", "sentry_B4": "BloonTrapUpgradeIcon", "sentry_B5": "XXXLUpgradeIcon", "plasma_T3": "SunAvatarUpgradeIcon", "plasma_T4": "SunTempleUpgradeIcon", "plasma_T5": "TrueSonGodUpgradeIcon", "plasma_M3": "RoboMonkeyUpgradeIcon", "plasma_M4": "TechTerrorUpgradeIcon", "plasma_M5": "TheAntiBloonUpgradeIcon", "plasma_B3": "DarkKnightUpgradeIcon", "plasma_B4": "DarkChampionUpgradeIcon", "plasma_B5": "LegendOfTheNightUpgradeIcon", "brew_T3": "BerserkerBrewUpgradeIcon", "brew_T4": "StrongerStimulantUpgradeIcon", "brew_T5": "PermanentBrewUpgradeIcon", "brew_M3": "UnstableConcoctionUpgradeIcon", "brew_M4": "TransformingTonicUpgradeIcon", "brew_M5": "TotalTransformationUpgradeIcon", "brew_B3": "LeadtoGoldUpgradeIcon", "brew_B4": "RubbertoGoldUpgradeIcon", "brew_B5": "BloonMasterAlchemistUpgradeIcon", "farm_T3": "BananaPlantationUpgradeIcon", "farm_T4": "BananaResearchFacilityUpgradeIcon", "farm_T5": "BananaCentralUpgradeIcon", "farm_M3": "MonkeyBankUpgradeIcon", "farm_M4": "IMFLoanUpgradeIcon", "farm_M5": "MonkeyNomicsUpgradeIcon", "farm_B3": "MarketplaceUpgradeIcon", "farm_B4": "CentralMarketUpgradeIcon", "farm_B5": "MonkeyWallStreetUpgradeIcon", "sub_T3": "SubmergeandSupportUpgradeIcon", "sub_T4": "BloontoniumReactorUpgradeIcon", "sub_T5": "EnergizerUpgradeIcon", "sub_M3": "BallisticMissileUpgradeIcon", "sub_M4": "FirstStrikeCapabilityUpgradeIcon", "sub_M5": "PreEmptiveStrikeUpgradeIcon", "sub_B3": "TripleGunsUpgradeIcon", "sub_B4": "ArmorPiercingDartsUpgradeIcon", "sub_B5": "SubCommanderUpgradeIcon", "buccaneer_T3": "DestroyerUpgradeIcon", "buccaneer_T4": "AircraftCarrierUpgradeIcon", "buccaneer_T5": "CarrierFlagshipUpgradeIcon", "buccaneer_M3": "CannonShipUpgradeIcon", "buccaneer_M4": "MonkeyPiratesUpgradeIcon", "buccaneer_M5": "PirateLordUpgradeIcon", "buccaneer_B3": "MerchantmanUpgradeIcon", "buccaneer_B4": "FavoredTradesUpgradeIcon", "buccaneer_B5": "TradeEmpireUpgradeIcon", "ace_T3": "FighterPlaneUpgradeIcon", "ace_T4": "OperationDartStormUpgradeIcon", "ace_T5": "SkyShredderUpgradeIcon", "ace_M3": "BomberAceUpgradeIcon", "ace_M4": "GroundZeroUpgradeIcon", "ace_M5": "TsarBombaUpgradeIcon", "ace_B3": "NevaMissTargetingUpgradeIcon", "ace_B4": "SpecterUpgradeIcon", "ace_B5": "FlyingFortressUpgradeIcon", "dartling_T3": "LaserCannonUpgradeIcon", "dartling_T4": "PlasmaAcceleratorUpgradeIcon", "dartling_T5": "RayOfDoomUpgradeIcon", "dartling_M3": "HydraRocketsUpgradeIcon", "dartling_M4": "RocketStormUpgradeIcon", "dartling_M5": "MadUpgradeIcon", "dartling_B3": "BuckshotUpgradeIcon", "dartling_B4": "BloonAreaDenialSystemUpgradeIcon", "dartling_B5": "BloonExclusionZoneUpgradeIcon", "desperado_T3": "300UpgradeIcon", "desperado_T4": "400UpgradeIcon", "desperado_T5": "500UpgradeIcon", "desperado_M3": "030UpgradeIcon", "desperado_M4": "040UpgradeIcon", "desperado_M5": "050UpgradeIcon", "desperado_B3": "003UpgradeIcon", "desperado_B4": "004UpgradeIcon", "desperado_B5": "005UpgradeIcon", "village_T3": "PrimaryTrainingUpgradeIcon", "village_T4": "PrimaryMentoringUpgradeIcon", "village_T5": "PrimaryExpertiseUpgradeIcon", "village_M3": "MonkeyIntelligenceBureauUpgradeIcon", "village_M4": "CallToArmsUpgradeIcon", "village_M5": "HomelandDefenseUpgradeIcon", "village_B3": "MonkeyTownUpgradeIcon", "village_B4": "MonkeyCityUpgradeIcon", "village_B5": "MonkeyNomicsUpgradeIcon"};
const PATH_NAME = { T: 'Top path', M: 'Middle path', B: 'Bottom path' };
const PATH_BONUS = { T: '+25% damage', M: '+20% attack speed', B: '+1 pierce, +25% vs MOABs & bosses' };
// which path drives this skill's look right now ('' = base line)
function curPath(sk) { return sk.lv >= 5 && sk.path5 ? sk.path5 : sk.lv >= 3 && sk.path3 ? sk.path3 : ''; }
function pathCount(sk, L) { return (sk.path3 === L) + (sk.path5 === L); }
function pathTier(sk) { return sk.lv >= 7 ? 5 : sk.lv >= 5 ? 4 : 3; }
// projectile art per path: [lv3-4, lv5-6, lv7]
const PATH_SPR = {
  dart: { T: ['SpikedBall_1', 'SpikedBall_1', 'SpikedBall_1'], M: ['TripleDart', 'TripleDart', 'PlasmaBlast'], B: ['Arrow', 'Arrow', 'MasterArrow'] },
  boomer: { T: ['Glaive', 'HotGlaive', 'GlaiveLordGlaive'], M: ['TurboRang', 'TurboRang', 'PermaChargeGlaive'], B: ['KylieBoomerang', 'KylieBoomerang', 'KylieBoomerang'] },
  bomb: { T: ['ReallyBigBomb', 'BoomProjectile', 'CrushProjectile'], M: ['ClusterBomb', 'ClusterBomb', 'ClusterBomb'], B: ['BigBomb', 'ReallyBigBomb', 'ReallyBigBomb'] },
  tack: { T: ['HotTack', 'HotTack', 'HotTack'], M: ['Blade', 'Blade', 'ParagonBlade'], B: ['Tack', 'Tack', 'IcicleTack'] },
  shuriken: { T: ['SharpShuriken', 'SharpShuriken', 'SharpSeekingShuriken'], M: ['Shuriken', 'SeekingShuriken', 'SharpSeekingShuriken'], B: ['StickyBomb', 'StickyBomb', 'StickyBomb'] },
  fire: { T: ['PlasmaBlast', 'PlasmaBlast', 'MeteorOrb'], M: ['FireBallStill', 'FireBallStill', 'FireBallStill'], B: ['DarkLightningBall', 'DarkLightningBall', 'DarkLightningBall'] },
  lightning: { T: ['BallLightning', 'BallLightning', 'BallLightning'], M: ['GlueDrop', 'GlueDrop', 'GlueDrop'], B: ['AvatarOfWrathBolt', 'AvatarOfWrathBolt', 'AvatarOfWrathBolt'] },
  plasma: { T: ['BlastSunAvatar', 'SunTempleBlast', 'SunTempleBlast'], M: ['PlasmaBullet', 'LaserBlast', 'LaserBlast'], B: ['DarkLightningBall', 'DarkLightningBall', 'DarkLightningBall'] },
  sub: { M: ['BallisticMissile', 'FirstStrikeMissile', 'PreemptiveStrikeMissile'] },
  dartling: { T: ['LaserCannon', 'LaserCannon', 'LaserCannon'], M: ['HydraRocketPod', 'RocketStormRocket', 'RocketStormRocket'], B: ['ShotgunBullet', 'ShotgunBullet', 'ShotgunBullet'] },
  mermonkey: { T: ['Javelin300', 'Javelin400', 'Javelin500'], M: ['Javelin030', 'Javelin040', 'Javelin050'], B: ['Javelin003', 'Javelin004', 'Javelin005'] },
  ace: { M: ['ComancheBomb', 'MoabBarrageBomb', 'MoabBarrageBomb'], B: ['SpectreDart', 'SpectreDart', 'SpectreDart'] },
};
// Paragons (level 8): a maxed tower can be merged into its BTD6 Paragon once you hold three maxed towers
const PARAGONS = { dart: 'Apex Plasma Master', boomer: 'Glaive Dominus', bomb: 'Ballistic Obliteration Missile Bunker', lightning: 'Root of All Nature', sentry: 'Master Builder',
  frost: 'Herald of Everfrost', buccaneer: 'Navarch of the Seas', sub: 'Nautic Siege Core', shuriken: 'Ascended Shadow', sniper: 'Sniper Paragon', spike: 'Mega Massive Munitions Factory',
  tack: 'Cyclone of Fire and Metal', fire: 'Magus Perfectus', ace: 'Goliath Doomship' };
const paragonReady = sk => !sk.hero && sk.lv === MAXLV && PARAGONS[sk.id] && G.skills.filter(k => !k.hero && k.lv >= MAXLV).length >= 3 && !G.banished.has('para_' + sk.id);
// Beast Handler: which beasts are out at each skill level, and how hard they hit
const BEASTS = {
  raptor1: { dmg: 1 }, raptor2: { dmg: 1.3 }, raptor3: { dmg: 1.7 }, trex2: { dmg: 2.4 }, trex3: { dmg: 3 }, giga3: { dmg: 4.2 },
  eagle1: { dmg: 0.8, bird: true }, eagle2: { dmg: 1.1, bird: true }, condor2: { dmg: 1.5, bird: true }, pouakai2: { dmg: 2, bird: true, stun: true }, pouakai3: { dmg: 2.8, bird: true, stun: true },
};
const BEAST_ROSTER = { 1: ['raptor1'], 2: ['raptor2'], 3: ['raptor2', 'eagle1'], 4: ['raptor2', 'eagle2'], 5: ['raptor3', 'condor2'], 6: ['trex3', 'pouakai2'], 7: ['giga3', 'pouakai3', 'raptor3'] };
const SKILLS = {
  dart: { name: 'Dart Monkey', icon: ['DartMonkey', 'DartMonkeyIcon'], tags: ['proj'], cd: 0.75, dmg: 5,
    lv: ['Sharp Shots: +1 dart', 'Razor Sharp Shots: +25% damage', 'Long Range Darts: +1 pierce', 'Enhanced Eyesight: +1 dart', 'Triple Shot: +30% attack speed', 'Crossbow Master: +2 darts, +2 pierce'],
    desc: 'Throws darts at the nearest bloon.' },
  boomer: { name: 'Boomerang Monkey', icon: ['BoomerangMonkey', 'BoomerangMonkeyIcon'], tags: ['proj'], cd: 1.3, dmg: 6,
    lv: ['Improved Rangs: +1 glaive', 'Glaives: +25% damage', 'Glaive Ricochet: +3 pierce', 'Faster Throwing: +1 glaive', 'MOAR Glaives: +30% size', 'Glaive Lord: +2 glaives orbit you'],
    desc: 'Hurls glaives that arc out and return, hitting everything.' },
  bomb: { name: 'Bomb Shooter', icon: ['BombShooter', 'BombShooterIcon'], tags: ['proj', 'area', 'fire'], cd: 1.6, dmg: 10,
    lv: ['Bigger Bombs: +25% radius', 'Heavy Bombs: +30% damage', 'Frag Bombs: +1 bomb', 'Really Big Bombs: +25% radius', 'Bloon Impact: +40% damage', 'MOAB Eliminator: x3 damage vs MOABs, cluster bombs'],
    desc: 'Lobs bombs that explode in an area.' },
  tack: { name: 'Tack Shooter', icon: ['TackShooter', 'TackShooterIcon'], tags: ['proj'], cd: 1.1, dmg: 4,
    lv: ['Faster Shooting: +4 tacks', 'Long Range Tacks: +25% damage', 'Blade Shooter: +1 pierce', 'More Tacks: +4 tacks', 'Tack Sprayer: +30% attack speed', 'Inferno Ring: burning ring every cast'],
    desc: 'Fires a ring of tacks around you.' },
  frost: { name: 'Ice Monkey', icon: ['IceMonkey', 'IceMonkeyIcon'], tags: ['area', 'frost'], cd: 1.0, dmg: 2,
    lv: ['Larger Radius: +20% radius', 'Enhanced Freeze: +40% damage', 'Deep Freeze: Freeze lasts +50%', 'Arctic Wind: +20% radius', 'Snowstorm: +50% damage', 'Absolute Zero: pulses freeze solid'],
    desc: 'Pulses cold around you, damaging and slowing bloons.' },
  glue: { name: 'Glue Gunner', icon: ['GlueGunnerIcon'], tags: ['area'], cd: 2.2, dmg: 3,
    lv: ['Glue Soak: +1 puddle', 'Corrosive Glue: +30% damage', 'Bigger Globs: +30% radius', 'Glue Splatter: +1 puddle', 'Glue Hose: +50% duration', 'Bloon Solver: corrosive glue melts layers'],
    desc: 'Splatters corrosive glue puddles that slow and damage.' },
  sniper: { name: 'Sniper Monkey', icon: ['SniperMonkeyIcon'], tags: ['proj'], cd: 1.8, dmg: 30,
    lv: ['Full Metal Jacket: +30% damage', 'Large Calibre: +2 pierce', 'Night Vision Goggles: +30% attack speed', 'Deadly Precision: +50% damage', 'Semi-Automatic: +1 shot', 'Cripple MOAB: shots stun & deal x2 to MOABs'],
    desc: 'Snipes the toughest bloon on screen for huge damage.' },
  shuriken: { name: 'Ninja Monkey', icon: ['NinjaMonkey', 'NinjaMonkeyIcon'], tags: ['proj'], cd: 0.9, dmg: 4.5,
    lv: ['Ninja Discipline: +1 shuriken', 'Sharp Shurikens: +25% damage', 'Double Shot: +1 pierce', 'Bloonjitsu: +1 shuriken', 'Counter-Espionage: +25% crit chance', 'Grandmaster Ninja: +3 shurikens'],
    desc: 'Throws homing shurikens.' },
  fire: { name: 'Wizard Monkey', icon: ['WizardIcon'], tags: ['area', 'fire'], cd: 0.12, dmg: 1.4,
    lv: ['Guided Magic: +20% range', 'Fireball: +30% damage', 'Wall of Fire: +20% width', 'Dragon\'s Breath: +30% damage', 'Summon Phoenix: +20% range', 'Wizard Lord Phoenix: summons a phoenix'],
    desc: 'Breathes a constant stream of fire at nearby bloons.' },
  lightning: { name: 'Druid', icon: ['DruidIcon'], tags: ['lightning'], cd: 1.2, dmg: 7,
    lv: ['Hard Thorns: +1 chain', 'Heart of Thunder: +30% damage', 'Druid of the Storm: +1 bolt', 'Ball Lightning: +2 chains', 'Superstorm: +30% attack speed', 'Avatar of Wrath: bolts strike twice'],
    desc: 'Lightning that chains between bloons.' },
  spike: { name: 'Spike Factory', icon: ['SpikeFactoryIcon'], tags: ['trap'], cd: 1.4, dmg: 6,
    lv: ['Bigger Stacks: +1 pile', 'White Hot Spikes: +5 pierce', 'Spiked Balls: +30% damage', 'Spiked Mines: +1 pile', 'Long Life Spikes: +50% duration', 'Perma-Spike: piles never expire, +10 pierce'],
    desc: 'Drops spike piles that pop bloons rolling over them.' },
  mortar: { name: 'Mortar Monkey', icon: ['MortarMonkeyIcon'], tags: ['area', 'fire'], cd: 1.5, dmg: 12,
    lv: ['Bigger Blast: +1 shell', 'Bloon Buster: +25% radius', 'Shell Shock: +30% damage', 'The Big One: +1 shell', 'Rapid Reload: +30% attack speed', 'Pop and Awe: stuns everything hit'],
    desc: 'Shells rain down on clusters of bloons.' },
  heli: { name: 'Heli Pilot', icon: ['HeliPilotIcon'], tags: ['summon', 'proj'], cd: 0.35, dmg: 2.5,
    lv: ['Quad Darts: +25% fire rate', 'Bigger Jets: +1 heli', 'Razor Rotors: +30% damage', 'IFR: +1 pierce', 'Apache Dartship: +1 heli', 'Apache Prime: helis fire lasers'],
    desc: 'Helicopters circle you and gun down bloons.' },
  sentry: { name: 'Engineer Monkey', icon: ['EngineerMonkey', 'EngineerMonkeyIcon'], tags: ['summon', 'proj'], cd: 4.0, dmg: 3,
    lv: ['Sentry Gun: +1 sentry', 'Faster Engineering: +30% damage', 'Sprockets: +50% duration', 'Sentry Expert: +1 sentry', 'Cleansing Foam: +30% fire rate', 'Sentry Champion: sentries fire plasma'],
    desc: 'Deploys sentry turrets that shoot nearby bloons.' },
  plasma: { name: 'Super Monkey', icon: ['SuperMonkey', 'SuperMonkeyIcon'], tags: ['proj'], cd: 0.11, dmg: 2.4,
    lv: ['Laser Blasts: +25% damage', 'Plasma Blasts: +1 pierce', 'Sun Avatar: +20% fire rate', 'Super Range: +30% damage', 'Epic Range: Twin shots', 'Sun Temple: 3-way sun beams'],
    desc: 'A relentless stream of plasma blasts.' },
  brew: { name: 'Alchemist', icon: ['AlchemistIcon'], tags: ['buff'], cd: 10, dmg: 0,
    lv: ['Larger Potions: +1s duration', 'Acidic Mixture Dip: +10% buff power', 'Berserker Brew: -1.5s cooldown', 'Stronger Stimulant: +1s duration', 'Permanent Brew: +10% buff power', 'Total Transformation: always active'],
    desc: 'Periodically empowers you: +35% damage & attack speed for 4s.' },
  farm: { name: 'Banana Farm', icon: ['BananaFarmIcon'], tags: ['buff'], cd: 6, dmg: 0,
    lv: ['Increased Production: +1 banana', 'Greater Production: +30% healing', 'Banana Plantation: -1s cooldown', 'Banana Research Facility: +1 banana', 'Valuable Bananas: +30% healing', 'Monkey Wall Street: bananas give big XP'],
    desc: 'Grows bananas nearby that heal you and grant souls.' },
  sub: { name: 'Monkey Sub', icon: ['MonkeySubIcon'], tags: ['proj', 'area'], cd: 2.2, dmg: 9,
    lv: ['Longer Range: +1 torpedo', 'Advanced Intel: +30% radius', 'Barbed Darts: +30% damage', 'Twin Guns: +1 torpedo', 'Ballistic Missile: +30% attack speed', 'Pre-emptive Strike: missiles hit the strongest bloons'],
    desc: 'Fires straight torpedoes that explode on impact.' },
  desperado: { name: 'Desperado', icon: ['DesperadoIcon'], tags: ['proj'], cd: 0.6, dmg: 6,
    lv: ['Quick Draw: +30% fire rate', 'Pointed Bullets: +2 pierce', 'Twin Six-Shooters: +1 shot', 'Deadeye: +40% damage', 'Bounty Hunter: +25% crit chance', 'Golden Justice: bullets ricochet to 3 more bloons'],
    desc: 'Fan-fires revolver shots at the closest bloons.' },
  buccaneer: { name: 'Monkey Buccaneer', icon: ['MonkeyBuccaneerIcon'], tags: ['proj', 'area'], cd: 1.7, dmg: 8,
    lv: ['Grape Shot: +3 grapes', 'Faster Shooting: +25% attack speed', 'Destroyer: +1 cannonball', 'Hot Shot: cannonballs burn', 'Cannon Ship: +40% damage', 'Monkey Pirates: x3 damage vs MOABs & bosses'],
    desc: 'Broadside cannonballs that burst, plus a spray of grapes.' },
  ace: { name: 'Monkey Ace', icon: ['MonkeyAceIcon'], tags: ['summon', 'proj'], cd: 1.4, dmg: 3.5,
    lv: ['Rapid Fire: +25% fire rate', 'Sharper Darts: +2 pierce', 'Neva-Miss Targeting: darts home in', 'Spy Plane: +4 darts per radial', 'Exploding Pineapple: drops bombs', 'Ground Zero: periodic massive bomb'],
    desc: 'A Monkey Ace circles overhead firing 8-way radial darts.' },
  dartling: { name: 'Dartling Gunner', icon: ['DartlingGunnerIcon'], tags: ['proj'], cd: 0.09, dmg: 1.7,
    lv: ['Focused Firing: tighter spread', 'Faster Barrel Spin: +25% fire rate', 'Hydra Rocket Pods: rockets every 12 shots', 'Laser Shock: +40% damage', 'Buckshot: +2 bullets', 'Ray of Doom: a piercing death ray'],
    desc: 'Sprays a hail of darts toward your aim.' },
  mermonkey: { name: 'Mermonkey', icon: ['MermonkeyIcon'], tags: ['proj', 'frost'], cd: 1.2, dmg: 6,
    lv: ['Sharper Prongs: +3 pierce', 'Echosense: +1 wave', 'Riptide Champion: +40% damage', 'Arctic Knight: waves slow bloons', 'Abyss Dweller: +30% wave size', 'Lord of the Abyss: waves freeze, x2 damage'],
    desc: 'Throws trident waves that slice through lines of bloons.' },
  village: { name: 'Monkey Village', icon: ['MonkeyVillageIcon'], tags: ['buff'], cd: 1, dmg: 0,
    lv: ['Bigger Radius: +5% damage', 'Jungle Drums: +10% attack speed', 'Primary Training: +1 pierce', 'Monkey Commerce: +25% gold', 'Monkey Intelligence Bureau: +10% damage', 'Monkey City: +50% gold, chests 15% cheaper'],
    desc: 'A village travels with you: +10% damage and +15% gold from pops.' },
  beast: { name: 'Beast Handler', icon: ['BeastHandlerIcon'], tags: ['summon'], cd: 0.6, dmg: 9,
    lv: ['Velociraptor: raptor grows, +30% damage', 'Golden Eagle: a bird of prey joins the hunt', 'Eagle Talons: bigger eagle, bites stun', 'Giant Condor: alpha raptor, +40% speed, condor joins', 'Tyrannosaurus Rex + Pouakai: +50% damage', 'Giganotosaurus: x3 vs MOABs, + Pouakai and a raptor pack'],
    desc: 'A Beast Handler charges into bloons and mauls them.' },
};

// ---------------------------------------------------------------- stat upgrades (Soulstone-style tagged cards)
const RARITY = [   // card rarity odds: Common 50%, Uncommon 25%, Rare 15%, Epic 7.5%, Legendary 2.5%
  { id: 'common', name: 'Common', w: 50, luck: -1, m: 1, c: 'var(--common)' },
  { id: 'uncommon', name: 'Uncommon', w: 25, luck: -0.5, m: 1.5, c: 'var(--uncommon)' },
  { id: 'rare', name: 'Rare', w: 15, luck: 0.5, m: 2, c: 'var(--rare)' },
  { id: 'epic', name: 'Epic', w: 7.5, luck: 0.2, m: 3, c: 'var(--epic)' },
  { id: 'legendary', name: 'Legendary', w: 2.5, luck: 0.1, m: 4, c: 'var(--legendary)' },
];
// every 10 luck: legendary +1%, epic +2%, rare +5%, common -10%, uncommon -5% (tower cards from chests only get the bonuses, never the penalties)
function rarityWeights(tower = false) {
  const L = G ? G.stats.luck || 0 : 0;
  return RARITY.map(r => Math.max(0, r.w + (r.luck < 0 && tower ? 0 : r.luck * L)));
}
const STAT_CARDS = [
  { id: 'dmg', name: 'Sharper Darts', icon: ['DamageIconLarge'], v: 0.08, fmt: v => `+${pct(v)} damage`, apply: (s, v) => s.dmg += v },
  { id: 'cdr', name: 'Faster Reload', icon: ['QuickHandsIcon'], v: 0.06, fmt: v => `+${pct(v)} attack speed`, apply: (s, v) => s.cdr += v },
  { id: 'area', name: 'Bigger Bombs', icon: ['MoreSplodyIcon'], v: 0.08, fmt: v => `+${pct(v)} area size`, apply: (s, v) => s.area += v },
  { id: 'crit', name: 'Critical Shot', icon: ['WeakPointIcon'], v: 0.035, fmt: v => `+${pct(v)} critical chance`, apply: (s, v) => s.crit += v },
  { id: 'critm', name: 'Lethal Strikes', icon: ['ViolentImpactIcon'], v: 0.15, fmt: v => `+${pct(v)} critical damage`, apply: (s, v) => s.critMult += v },
  { id: 'hp', name: 'Thick Skin', icon: ['LivesIcon'], v: 12, fmt: v => `+${Math.round(v)} max health`, apply: (s, v, g) => { s.maxhp += v; g.player.hp += v; } },
  { id: 'regen', name: 'Banana Diet', icon: ['HealthyBananasIcon'], v: 0.35, fmt: v => `+${v.toFixed(1)} health / sec`, apply: (s, v) => s.regen += v },
  { id: 'spd', name: 'Monkey Agility', icon: ['HeroicVelocityIcon'], v: 0.05, fmt: v => `+${pct(v)} move speed`, apply: (s, v) => s.speed += v },
  { id: 'magnet', name: 'Soul Magnet', icon: ['BigBunchIcon'], v: 0.9, fmt: v => `+${v.toFixed(1)}m pickup range`, apply: (s, v) => s.magnet += v },
  { id: 'xp', name: 'Monkey Knowledge', icon: ['MonkeyEducationIcon'], v: 0.07, fmt: v => `+${pct(v)} soul gain`, apply: (s, v) => s.xp += v },
  { id: 'luck', name: 'Lucky Banana', icon: ['GoldenBloon'], v: 2, fmt: v => `+${Math.round(v)} luck (rarer cards)`, apply: (s, v) => s.luck += Math.round(v) },
  { id: 'dash', name: 'Extra Dash', icon: ['Dash_Icon'], v: 1, minR: 4, fmt: () => `+1 dash charge (${G.stats.dashes + 1}/3)`, apply: s => { s.dashes = Math.min(3, s.dashes + 1); G.player.dashN = Math.min(s.dashes, (G.player.dashN || 0) + 1); } },
  { id: 'pierce', name: 'Extra Pierce', icon: ['HardTacksIcon'], v: 0.5, fmt: v => `+${Math.max(1, Math.round(v))} pierce (projectiles)`, apply: (s, v) => s.pierce += Math.max(1, Math.round(v)), minR: 2 },
  { id: 'multi', name: 'Multishot', icon: ['ExtraDartsPopIcon'], v: 0.34, fmt: v => `+${Math.max(1, Math.round(v))} projectile`, apply: (s, v) => s.proj += Math.max(1, Math.round(v)), minR: 3 },
  { id: 'dur', name: 'Lingering Magic', icon: ['LingeringMagicIcon'], v: 0.1, fmt: v => `+${pct(v)} effect duration`, apply: (s, v) => s.dur += v },
  { id: 'tag_proj', name: 'Projectile Mastery', icon: ['CrossbowReachIcon'], tag: 'proj', v: 0.12, fmt: v => `+${pct(v)} damage with Projectile skills`, apply: (s, v) => s.tag.proj += v },
  { id: 'tag_area', name: 'Area Mastery', icon: ['BigInfernoIcon'], tag: 'area', v: 0.12, fmt: v => `+${pct(v)} damage with Area skills`, apply: (s, v) => s.tag.area += v },
  { id: 'tag_fire', name: 'Fire Mastery', icon: ['HotMagicIcon'], tag: 'fire', v: 0.15, fmt: v => `+${pct(v)} damage with Fire skills`, apply: (s, v) => s.tag.fire += v },
  { id: 'tag_frost', name: 'Frost Mastery', icon: ['IcyChillIcon'], tag: 'frost', v: 0.15, fmt: v => `+${pct(v)} damage with Frost skills`, apply: (s, v) => s.tag.frost += v },
  { id: 'tag_lightning', name: 'Storm Mastery', icon: ['GorgonStormIcon'], tag: 'lightning', v: 0.15, fmt: v => `+${pct(v)} damage with Lightning skills`, apply: (s, v) => s.tag.lightning += v },
  { id: 'tag_summon', name: 'Commander', icon: ['VigilantSentriesIcon'], tag: 'summon', v: 0.15, fmt: v => `+${pct(v)} damage with Summon skills`, apply: (s, v) => s.tag.summon += v },
  { id: 'tag_trap', name: 'Trap Mastery', icon: ['OneMoreSpikeIcon'], tag: 'trap', v: 0.15, fmt: v => `+${pct(v)} damage with Trap skills`, apply: (s, v) => s.tag.trap += v },
];
STAT_CARDS.push(
  { id: 'herodmg', name: 'Hero Training', icon: ['HeroFavorsIcon'], v: 0.12, fmt: v => `+${pct(v)} hero attack damage`, apply: (s, v) => s.heroDmg += v },
  { id: 'heroproj', name: 'Hero Multishot', icon: ['ExtraDartsPopIcon'], v: 1, heroExtra: true, minR: 2, fmt: () => `+1 hero projectile (${G.stats.heroExtra + 1}/5)`, apply: s => s.heroExtra = Math.min(5, s.heroExtra + 1) },
  { id: 'herostrike', name: 'Hero Flurry', icon: ['HeroicReachIcon'], v: 1, heroExtra: true, minR: 2, fmt: () => `+1 extra attack per swing (${G.stats.heroExtra + 1}/5)`, apply: s => s.heroExtra = Math.min(5, s.heroExtra + 1) },
);
const pct = v => `${Math.round(v * 100)}%`;
const TAGNAME = { proj: 'Projectile', area: 'Area', fire: 'Fire', frost: 'Frost', lightning: 'Lightning', summon: 'Summon', trap: 'Trap', buff: 'Buff' };

const CHAOS = [
  { n: 'I', hp: 1.0, dmg: 1.0, rate: 1.0, xp: 1.0, goal: 2500 },
  { n: 'II', hp: 1.45, dmg: 1.25, rate: 1.15, xp: 1.1, goal: 2500 },
  { n: 'III', hp: 2.1, dmg: 1.5, rate: 1.3, xp: 1.2, goal: 2500 },
  { n: 'IV', hp: 3.0, dmg: 1.8, rate: 1.45, xp: 1.3, goal: 2500 },
  { n: 'V', hp: 4.4, dmg: 2.2, rate: 1.6, xp: 1.45, goal: 2500 },
  { n: 'VI', hp: 6.5, dmg: 2.7, rate: 1.8, xp: 1.6, goal: 2500 },
];

// ---------------------------------------------------------------- canvas & input
const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');
let W = 0, H = 0, DPR = 1, Z = 30; // Z = pixels per world unit
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 1.25);
  W = cv.width = Math.floor(innerWidth * DPR);
  H = cv.height = Math.floor(innerHeight * DPR);
  Z = H / 30; // ~30 world units visible vertically (Soulstone-like framing)
}
addEventListener('resize', resize); resize();
const keys = {};
const mouse = { x: 0, y: 0 };
addEventListener('keydown', e => {
  keys[e.code] = true;
  if (!G) return;
  const K = SETTINGS.keys;
  if (e.code === K.pause || (e.code === 'Escape' && K.pause !== 'Escape')) togglePause();
  if (e.code === K.aim && G.state === 'play') { G.manualAim = !G.manualAim; toast(G.manualAim ? 'Mouse aim ON' : 'Auto aim ON'); }
  if (e.code === K.dash || (K.dash === 'Space' && e.code === 'ShiftLeft')) tryDash();
  if (e.code === K.interact && G.state === 'play') G.useKey = true;
  if (e.code === K.ability) useAbility();
  if (G.state === 'levelup' && /Digit[1-5]/.test(e.code)) { const b = document.querySelectorAll('.card')[+e.code.slice(5) - 1]; b && b.click(); }
});
addEventListener('keyup', e => keys[e.code] = false);
addEventListener('mousemove', e => { mouse.x = e.clientX * DPR; mouse.y = e.clientY * DPR; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; if (G && G.state === 'play') togglePause(); });

// ---------------------------------------------------------------- map
class Arena {
  constructor(def) {
    this.def = def;
    this.cols = def.cols; this.rows = def.rows; this.cell = def.cell;
    this.w = this.cols * this.cell; this.h = this.rows * this.cell;
    const bin = atob(def.grid);
    const n = this.cols * this.rows;
    this.walk = new Uint8Array(n);
    for (let i = 0; i < n; i++) this.walk[i] = (bin.charCodeAt(i >> 3) >> (7 - (i & 7))) & 1;
    this.cells = [];
    for (let i = 0; i < n; i++) if (this.walk[i]) this.cells.push(i);
    this.flow = new Uint16Array(n);
    this.queue = new Int32Array(n);
    this.buildMask();
  }
  isWalk(x, y) {
    const c = Math.floor(x / this.cell), r = Math.floor(y / this.cell);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return false;
    return this.walk[r * this.cols + c] === 1;
  }
  free(x, y, rad) {
    if (!this.isWalk(x, y)) return false;
    const d = rad * 0.75;
    return this.isWalk(x + d, y) && this.isWalk(x - d, y) && this.isWalk(x, y + d) && this.isWalk(x, y - d);
  }
  // BFS flow field toward (x,y)
  computeFlow(x, y) {
    const C = this.cols, R = this.rows, walk = this.walk, flow = this.flow, q = this.queue;
    flow.fill(65535);
    let c = Math.floor(x / this.cell), r = Math.floor(y / this.cell);
    let start = r * C + c;
    if (!walk[start]) return;
    let h = 0, t = 0; q[t++] = start; flow[start] = 0;
    while (h < t) {
      const i = q[h++], d = flow[i] + 1, cc = i % C;
      if (d > 200) continue;
      if (cc > 0 && walk[i - 1] && flow[i - 1] > d) { flow[i - 1] = d; q[t++] = i - 1; }
      if (cc < C - 1 && walk[i + 1] && flow[i + 1] > d) { flow[i + 1] = d; q[t++] = i + 1; }
      if (i >= C && walk[i - C] && flow[i - C] > d) { flow[i - C] = d; q[t++] = i - C; }
      if (i < C * (R - 1) && walk[i + C] && flow[i + C] > d) { flow[i + C] = d; q[t++] = i + C; }
    }
  }
  flowAt(x, y) {
    const c = Math.floor(x / this.cell), r = Math.floor(y / this.cell);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return 65535;
    return this.flow[r * this.cols + c];
  }
  // direction to step along the flow field
  flowDir(x, y) {
    const C = this.cols, c = Math.floor(x / this.cell), r = Math.floor(y / this.cell);
    let best = this.flowAt(x, y), bx = 0, by = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const cc = c + dx, rr = r + dy;
      if (cc < 0 || rr < 0 || cc >= C || rr >= this.rows) continue;
      let v = this.flow[rr * C + cc];
      if (dx && dy) { // avoid corner cutting
        if (!this.walk[r * C + cc] || !this.walk[rr * C + c]) continue;
        v += 0.4;
      }
      if (v < best) { best = v; bx = dx; by = dy; }
    }
    const l = Math.hypot(bx, by) || 1;
    return [bx / l, by / l];
  }
  randomCellNear(x, y, dmin, dmax, tries = 40) {
    for (let k = 0; k < tries; k++) {
      const a = rnd(TAU), d = rnd(dmin, dmax);
      const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d;
      if (this.free(px, py, 0.8) && this.flowAt(px, py) < 65535) return [px, py];
    }
    for (let k = 0; k < tries; k++) {
      const i = pick(this.cells), px = (i % this.cols + 0.5) * this.cell, py = (Math.floor(i / this.cols) + 0.5) * this.cell;
      const d = Math.hypot(px - x, py - y);
      if (d > dmin && d < dmax * 2.5 && this.flowAt(px, py) < 65535) return [px, py];
    }
    return null;
  }
  buildMask() {
    const mask = document.createElement('canvas');
    mask.width = this.cols; mask.height = this.rows;
    const mg = mask.getContext('2d'), id = mg.createImageData(this.cols, this.rows);
    for (let i = 0; i < this.walk.length; i++) id.data[i * 4 + 3] = this.walk[i] ? 255 : 0;
    mg.putImageData(id, 0, 0);
    this.mask = mask; this.decals = [];
  }
  buildLayers() {
    const def = this.def, S = 10;
    const mask = document.createElement('canvas');
    mask.width = this.cols; mask.height = this.rows;
    const mg = mask.getContext('2d'), id = mg.createImageData(this.cols, this.rows);
    for (let i = 0; i < this.walk.length; i++) id.data[i * 4 + 3] = this.walk[i] ? 255 : 0;
    mg.putImageData(id, 0, 0);
    this.mask = mask;
    const ov = document.createElement('canvas');
    ov.width = Math.ceil(this.w * S); ov.height = Math.ceil(this.h * S);
    const g = ov.getContext('2d');
    // wall texture
    const wallImg = img(def.wall);
    const paint = () => {
      g.clearRect(0, 0, ov.width, ov.height);
      g.fillStyle = def.tint; g.fillRect(0, 0, ov.width, ov.height);
      if (wallImg.complete && wallImg.naturalWidth) {
        const p = g.createPattern(wallImg, 'repeat');
        const sc = (6 * S) / wallImg.naturalWidth; // 6 units per tile
        p.setTransform(new DOMMatrix().scale(sc));
        g.globalAlpha = 1; g.fillStyle = p; g.fillRect(0, 0, ov.width, ov.height); g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, 0, ov.width, ov.height);
      }
      // darken walls with a vignette from the edge (blurred mask)
      g.save(); g.globalCompositeOperation = 'source-over';
      g.filter = 'blur(22px)'; g.globalAlpha = 0.55;
      g.drawImage(this.blackMask(), 0, 0, ov.width, ov.height);
      g.restore();
      // cut out walkable area (crisp-ish)
      g.save(); g.globalCompositeOperation = 'destination-out';
      g.imageSmoothingEnabled = true;
      g.drawImage(mask, 0, 0, ov.width, ov.height);
      g.restore();
      // rim shadow cast onto the floor
      const sh = document.createElement('canvas'); sh.width = ov.width; sh.height = ov.height;
      const sg = sh.getContext('2d');
      sg.fillStyle = '#000'; sg.fillRect(0, 0, sh.width, sh.height);
      sg.globalCompositeOperation = 'destination-out'; sg.drawImage(mask, 0, 0, sh.width, sh.height);
      g.save(); g.globalCompositeOperation = 'destination-over'; g.filter = 'blur(9px)'; g.globalAlpha = 0.85;
      g.drawImage(sh, 0, 6, ov.width, ov.height); g.restore();
      // bright rim highlight on wall edge
      g.save(); g.globalCompositeOperation = 'source-atop'; g.filter = 'blur(3px)'; g.globalAlpha = 0.35;
      const rim = document.createElement('canvas'); rim.width = ov.width; rim.height = ov.height;
      const rg = rim.getContext('2d'); rg.drawImage(mask, 0, 0, rim.width, rim.height);
      rg.globalCompositeOperation = 'source-in'; rg.fillStyle = '#ffeec8'; rg.fillRect(0, 0, rim.width, rim.height);
      g.drawImage(rim, 0, -3, ov.width, ov.height); g.restore();
    };
    paint();
    if (!wallImg.complete) wallImg.addEventListener('load', paint);
    this.overlay = ov; this.S = S;
    // accent splotches on the floor (mud / snow / tiles) — scattered decals
    this.decals = [];
    for (let k = 0; k < Math.floor(this.cells.length / 900); k++) {
      const i = pick(this.cells);
      this.decals.push({ x: (i % this.cols) * this.cell, y: Math.floor(i / this.cols) * this.cell, r: rnd(2.5, 6), a: rnd(TAU) });
    }
  }
  blackMask() {
    // walls = black, walkable = transparent, used for depth darkening
    const c = document.createElement('canvas'); c.width = this.cols; c.height = this.rows;
    const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'destination-out'; g.drawImage(this.mask, 0, 0); return c;
  }
}

// ---------------------------------------------------------------- spatial hash
class Hash {
  constructor(cs) { this.cs = cs; this.m = new Map(); }
  clear() { this.m.clear(); }
  key(cx, cy) { return (cx + 2048) * 4096 + (cy + 2048); }
  add(o) {
    const cx = Math.floor(o.x / this.cs), cy = Math.floor(o.y / this.cs), k = this.key(cx, cy);
    let a = this.m.get(k); if (!a) this.m.set(k, a = []); a.push(o);
  }
  query(x, y, r, out) {
    out.length = 0;
    const cs = this.cs, x0 = Math.floor((x - r) / cs), x1 = Math.floor((x + r) / cs), y0 = Math.floor((y - r) / cs), y1 = Math.floor((y + r) / cs);
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
      const a = this.m.get(this.key(cx, cy)); if (a) for (const o of a) out.push(o);
    }
    return out;
  }
}
const _q = [];

// ---------------------------------------------------------------- game state
let G = null;
let menuSel = { char: 0, map: 0, chaos: 0 };
try { const s = JSON.parse(localStorage.getItem('bss_sel') || 'null'); if (s) menuSel = Object.assign(menuSel, s); } catch (e) { }
let BEST = {};
try { BEST = JSON.parse(localStorage.getItem('bss_best') || '{}'); } catch (e) { }

async function newGame() {
  const ch = CHARS[menuSel.char], mapDef = MAPS[menuSel.map], chaos = CHAOS[menuSel.chaos];
  show('menu', false); show('loading', true);
  const setMsg = m => { document.querySelector('#loading .lvtitle').textContent = m; };
  try {
    await R3.buildArena(mapDef.id, setMsg);
  } catch (e) {
    setMsg('Could not load arena: ' + e.message); console.error(e); return;
  }
  const skin = selectedSkin(ch);
  if (skin) await R3.loadSkin(skin.key);
  R3.setPlayerModel(skin && R3.hasRig(skin.key) ? skin.key : ch.model);
  R3.resetRun();
  show('loading', false);
  const arena = new Arena(mapDef);
  const stats = {
    dmg: 1, cdr: 0, area: 1, proj: 0, pierce: 0, crit: 0.05, critMult: 1.6, speed: 1, maxhp: ch.hp, regen: 0.2,
    magnet: 3.2, xp: 1, dur: 1, armor: 0, luck: 0, dashes: 1, chain: ch.chainBonus || 0, gold: 1, chestDisc: 0, heroDmg: 1, heroExtra: 0,
    tag: { proj: 1, area: 1, fire: 1, frost: 1, lightning: 1, summon: 1, trap: 1, buff: 1 },
  };
  for (const k in ch.bonus) stats[k] += ch.bonus[k];
  for (const k in (ch.tagBonus || {})) stats.tag[k] += ch.tagBonus[k];
  G = {
    state: 'play', t: 0, ch, chaos, chaosIdx: menuSel.chaos, arena, stats,
    player: { x: mapDef.spawn[0], y: mapDef.spawn[1], r: 0.6, hp: stats.maxhp, face: 1, vx: 0, vy: 0, inv: 0, dashCd: 0, dashT: 0, dashX: 0, dashY: 0, hurtT: 0, buffT: 0 },
    cam: { x: mapDef.spawn[0], y: mapDef.spawn[1], shake: 0 },
    skills: [], level: 1, xp: 0, xpNext: xpFor(1), pendingLevels: 0,
    bloons: [], projs: [], effects: [], pickups: [], texts: [], summons: [], hazards: [], eproj: [],
    hash: new Hash(2.5), flowT: 0, spawnBudget: 0, pops: 0, goal: chaos.goal, elitesSpawned: 0, boss: null, bossDone: false,
    towerPos: {}, runStats: {}, buf: { dmg: 0, heroDmg: 0, as: 0, shield: 0 }, abilCd: 8, drainT: 0, blindT: 0, towerStunT: 0, rerolls: 3, banishes: 2, banished: new Set(), manualAim: false, kills: 0, dmgDealt: 0, chests: 0,
    toast: null, toastT: 0, freeze: 0,
    gold: 0, goldEarned: 0, chestsOpened: 0, chestT: 35, items: {}, loop: 0, bossKills: 0, goalStart: 0, portals: null, grace: 0, mapIdx: menuSel.map,
  };
  META.start(stats, G);
  const hsk = { id: 'hero', hero: true, def: Object.assign({ icon: ch.spr, lv: [] }, HERO_ATK[ch.id]), lv: 1, cd: 0.6, t: 0, state: {} };
  G.skills.push(hsk);
  sndInit();
  setTimeout(() => voice('Place'), 600);
  arena.computeFlow(G.player.x, G.player.y);
  // small opening wave so it's not empty
  for (let i = 0; i < 10; i++) spawnBloon('red', null);
  show('menu', false); show('end', false); show('pause', false);
  toast(`${mapDef.name} — Chaos ${chaos.n}`);
}
async function continueRun() {
  G.portals = null; G.state = 'loading';
  play('BossPhayzeWarp', { vol: 0.8 });
  let idx = G.mapIdx; if (MAPS.length > 1) while (idx === G.mapIdx) idx = Math.floor(Math.random() * MAPS.length);
  const mapDef = MAPS[idx];
  show('loading', true);
  const setMsg = m => { document.querySelector('#loading .lvtitle').textContent = m; };
  setMsg('Portal to ' + mapDef.name + '…');
  try { await R3.buildArena(mapDef.id, setMsg); } catch (e) { setMsg('Could not load arena: ' + e.message); console.error(e); return; }
  show('loading', false);
  G.mapIdx = idx; G.arena = new Arena(mapDef);
  const P = G.player; P.x = mapDef.spawn[0]; P.y = mapDef.spawn[1]; P.vx = P.vy = 0; G.cam.x = P.x; G.cam.y = P.y;
  G.bloons = []; G.projs = []; G.eproj = []; G.hazards = []; G.effects = []; G.texts = [];
  const freeLeft = G.pickups.filter(q => q.kind === 'chest' && q.free).length;
  G.pickups = [];
  G.summons = G.summons.filter(sm => sm.kind !== 'sentry');
  for (const sm of G.summons) { sm.x = P.x + rnd(-1, 1); sm.y = P.y + rnd(-1, 1); }
  R3.resetRun();
  G.boss = null; G.loop++;
  G.goalStart = G.pops; G.goal = G.pops + Math.round(G.chaos.goal * (1 + 0.4 * G.loop)); G.elitesSpawned = 0;
  G.spawnBudget = 0; G.chestT = 30; G.grace = 10;
  G.arena.computeFlow(P.x, P.y);
  G.state = 'play';
  toast(`${mapDef.name} — Loop ${G.loop + 1}: bloons are stronger!`, '#ffcf5a');
  if (freeLeft) { G.pendingChest = (G.pendingChest || 0) + freeLeft; openLevelUp(true); }   // unopened boss chest comes with you
}
function xpFor(l) { return Math.floor(6 + l * 5 + Math.pow(l, 1.55) * 2.2); }

// ---------------------------------------------------------------- skills
function addSkill(id) {
  const sk = { id, def: SKILLS[id], lv: 1, cd: 0.4, t: 0, state: {} };
  G.skills.push(sk); (G.skillOf || (G.skillOf = {}))[id] = sk;
  if (SKILLS[id] && R3.loadTower) R3.loadTower(id);
  return sk;
}
const hasSkill = id => G.skills.find(s => s.id === id);
const villageSk = () => G.skills.find(s => s.id === 'village');
function villageDmg() { const v = villageSk(); return v ? 1.1 + (lvAt(v, 2) ? 0.05 : 0) + (lvAt(v, 6) ? 0.1 : 0) : 1; }
function goldMult() { const v = villageSk(); return G.stats.gold * (v ? 1.15 + (lvAt(v, 5) ? 0.25 : 0) + (lvAt(v, 7) ? 0.5 : 0) : 1); }
// Soulstone-style escalating chest price: each chest costs more than the last
function chestCost(n = G.chestsOpened) {
  const v = villageSk();
  const disc = (1 - G.stats.chestDisc) * (v && lvAt(v, 7) ? 0.85 : 1);
  return Math.max(25, Math.round(100 * (n + 1) * Math.pow(1.25, n) * disc / 10) * 10);
}
function tagMult(tags) { let m = 1; for (const t of tags) m *= (G.stats.tag[t] || 1); return m; }
function skillDmg(sk, mult = 1) {
  const s = G.stats;
  let d = sk.def.dmg * mult * s.dmg * tagMult(sk.def.tags) * (1 + 0.04 * (G.level - 1)) * villageDmg();
  if (G.player.buffT > 0) d *= G.brewPow || 1.35;
  if (!sk.hero && sk.lv >= 3) d *= Math.pow(1.25, pathCount(sk, 'T'));
  if (G.buf.dmg > 0) d *= 1.5;                                  // Rallying Roar
  if (sk.hero && G.buf.heroDmg > 0) d *= 2;                    // Armor Piercing Shells
  if (G.drainT > 0) d *= 0.65;                                  // drained by the Lych
  return d;
}
function cdOf(sk, base) {
  let as = 1 + G.stats.cdr;
  if (sk && !sk.hero && sk.lv >= 3) as *= Math.pow(1.2, pathCount(sk, 'M')); const vs = villageSk(); if (vs && lvAt(vs, 3)) as += 0.1;
  if (G.player.buffT > 0) as *= G.brewPow || 1.35;
  if (G.buf.as > 0) as *= 1.6;                                  // Naval Tactics / Kinetic Charge
  if (G.drainT > 0) as *= 0.75;
  return base / as;
}
const lvAt = (sk, n) => sk.lv >= n; // has reached level n
const NO_TOWER = { heli: 1, ace: 1, village: 1, farm: 1 };
function nearestBloon(x, y, maxd = 22, exclude) {
  let best = null, bd = maxd * maxd;
  for (const b of G.bloons) { if (b.dead || (exclude && exclude.has(b))) continue; const d = (b.x - x) ** 2 + (b.y - y) ** 2; if (d < bd && !(b.camo && d > CAMO_SIGHT * CAMO_SIGHT)) { bd = d; best = b; } }
  if (G.boss && !G.boss.dead && !(exclude && exclude.has(G.boss))) { const d = (G.boss.x - x) ** 2 + (G.boss.y - y) ** 2; if (d < bd) best = G.boss; }
  return best;
}
function aimDir(maxd = 22) {
  const p = G.player;
  if (G.manualAim) {
    const g = R3.screenToGame(mouse.x / DPR, mouse.y / DPR);
    if (!g) return null;
    const a = Math.atan2(g[1] - p.y, g[0] - p.x); return { a, target: null };
  }
  const b = nearestBloon(p.x, p.y, maxd);
  if (!b) return null;
  return { a: Math.atan2(b.y - p.y, b.x - p.x), target: b };
}
// BTD6 projectile art per tower skill, upgrading with the skill level ({kind: {level: sprite}}; '*' = any kind)
const PROJ_SPR = {
  dart: { '*': { 1: 'Dart', 3: 'PowerfulDart', 5: 'Arrow', 7: 'MasterArrow', 8: 'PlasmaBlast' } },
  boomer: { '*': { 1: 'Boomerang', 3: 'Glaive', 5: 'HotGlaive', 6: 'GoldenGlaive', 7: 'GlaiveLordGlaive' } },
  bomb: { '*': { 1: 'Bomb', 3: 'BigBomb', 5: 'ReallyBigBomb' } },
  tack: { '*': { 1: 'Tack', 4: 'Blade', 7: 'ParagonBlade' } },
  shuriken: { '*': { 1: 'Shuriken', 3: 'SharpShuriken', 5: 'SeekingShuriken', 7: 'SharpSeekingShuriken' } },
  fire: { '*': { 1: 'PlasmaBlast', 3: 'FireBallStill' } },
  lightning: { '*': { 1: 'BallLightning' } },
  plasma: { '*': { 1: 'Dart', 3: 'LaserBlast', 4: 'PlasmaBlast', 5: 'BlastSunAvatar', 7: 'SunTempleBlast' } },
  sub: { torpedo: { 1: 'BallisticMissile', 7: 'PreemptiveStrikeMissile' }, '*': { 1: 'SubDart', 6: 'BallisticMissile', 7: 'PreemptiveStrikeMissile' } },
  buccaneer: { bomb: { 1: 'CannonBall' }, bullet: { 1: 'GrapeShot' }, '*': { 1: 'BuccaneerDart' } },
  desperado: { '*': { 1: 'Bullet' } },
  ace: { bomb: { 1: 'ComancheBomb', 6: 'MoabBarrageBomb' }, torpedo: { 1: 'UCAVMissileSprite' }, '*': { 1: 'DartSprite', 4: 'SpectreDart' } },
  dartling: { torpedo: { 1: 'HydraRocketPod', 7: 'RocketStormRocket' }, '*': { 1: 'Dart', 3: 'PowerfulDart', 4: 'LaserCannon', 5: 'RocketStormRocket' } },
  mermonkey: { '*': { 1: 'Javelin000', 3: 'Javelin100', 4: 'Javelin200', 5: 'Javelin300', 6: 'Javelin400', 7: 'Javelin500' } },
  heli: { torpedo: { 1: 'ApacheMissile' }, '*': { 1: 'Dart', 3: 'PowerfulDart', 5: 'SpectreDart' } },
  sentry: { '*': { 1: 'Bullet', 3: 'LaserBolt', 5: 'PlasmaBullet' } },
  sniper: { '*': { 1: 'Bullet' } },
  brew: { '*': { 1: 'RejuvPotion' } },
  // hero signature attacks
  quincy: { '*': { 1: 'Arrow' } }, brickell: { '*': { 1: 'Bullet' } }, geraldo: { '*': { 1: 'Bullet' } }, etienne: { '*': { 1: 'ETNDartSprite' } },
  adora: { '*': { 1: 'BallofLightAA' } }, silas: { '*': { 1: 'IceShard' } }, corvus: { '*': { 1: 'SpiritSpear' } }, churchill: { '*': { 1: 'TankShell' } }, striker: { '*': { 1: 'TankShell' } },
};
let CUR_SK = null;
function projSprite(sk, kind) {
  const id = sk.hero ? G.ch.id : sk.id, m = PROJ_SPR[id]; if (!m) return null;
  const L = !sk.hero && curPath(sk), ps = L && PATH_SPR[id] && PATH_SPR[id][L];
  if (ps && !(m[kind] && kind !== 'bullet' && kind !== 'dart')) return ps[sk.lv >= 7 ? 2 : sk.lv >= 5 ? 1 : 0];
  const t = m[kind] || m['*']; if (!t) return null;
  let best = null; for (const L of Object.keys(t).map(Number).sort((a, b) => a - b)) if (L <= (sk.lv || 1)) best = t[L];
  return best;
}
// run stats per source ('hero' = the player, otherwise a tower skill id): damage, pops, gold, xp, healing
let SRC = 'hero';
function rs(src = SRC) { const r = G.runStats || (G.runStats = {}); return r[src] || (r[src] = { dmg: 0, pops: 0, gold: 0, xp: 0, heal: 0 }); }
function shoot(o) {
  // generic projectile
  const p = Object.assign({ x: G.player.x, y: G.player.y, vx: 0, vy: 0, r: 0.25, dmg: 1, pierce: 1, life: 1.6, tags: ['proj'], hits: new Set(), kind: 'dart', rot: 0, t: 0 }, o);
  if (o.a !== undefined) { p.vx = Math.cos(o.a) * o.speed; p.vy = Math.sin(o.a) * o.speed; p.rot = o.a; }
  const vs = villageSk(); if (vs && lvAt(vs, 4) && !o.onHit) p.pierce += 1;
  if (p.spr === undefined && CUR_SK) p.spr = projSprite(CUR_SK, p.kind);
  if (CUR_SK && !CUR_SK.hero && CUR_SK.lv >= 3) p.pierce += pathCount(CUR_SK, 'B');
  p.src = o.src || SRC;
  G.projs.push(p);
  return p;
}
function explode(x, y, r, dmg, tags, opts = {}) {
  G.effects.push({ kind: 'boom', x, y, r, t: 0, life: 0.35, color: opts.color || '#ffb347' });
  hitArea(x, y, r, dmg, tags, opts);
  if (r > 1.6) shake(0.12);
}
function hitArea(x, y, r, dmg, tags, opts = {}) {
  G.hash.query(x, y, r + 3, _q);
  const list = _q.slice();
  if (G.boss && !G.boss.dead) list.push(G.boss);
  for (const b of list) {
    if (b.dead) continue;
    if ((b.x - x) ** 2 + (b.y - y) ** 2 < (r + b.r) ** 2) {
      damage(b, dmg, tags, opts);
      if (opts.slow) b.slowT = Math.max(b.slowT, opts.slow);
      if (opts.freeze && !b.def.frostImmune && !b.def.moab && !b.isBoss) b.frozenT = Math.max(b.frozenT, opts.freeze);
      if (opts.stun && !b.isBoss) { if (!(b.stunT > 0) && SETTINGS.dmgNumbers && Math.random() < 0.35) G.texts.push({ x: b.x, y: b.y - b.r - 0.3, s: 'STUN', t: 0, life: 0.7, kind: 'stun' }); b.stunT = Math.max(b.stunT, opts.stun); }
    }
  }
}

const CAST = {
  hero(sk) {
    const d = sk.def, p = G.player, extra = G.stats.heroExtra, dm = skillDmg(sk) * G.stats.heroDmg;
    let fired = false;
    if (d.type === 'proj' && d.drones) {
      // Etienne: two UCAV drones orbit him; each one targets its own nearest bloon and fires from where it is
      while (G.summons.filter(x => x.kind === 'drone').length < 2) G.summons.push({ kind: 'drone', sk, x: p.x, y: p.y, a: G.summons.length * 3, face: 0 });
      const per = Math.ceil((1 + extra) / 2);
      for (const dr of G.summons.filter(x => x.kind === 'drone')) {
        const t = nearestBloon(dr.x, dr.y, 18); if (!t) continue;
        const a0 = Math.atan2(t.y - dr.y, t.x - dr.x); dr.face = a0; dr.anim = 'attack';
        for (let i = 0; i < per; i++) shoot({ x: dr.x, y: dr.y, a: a0 + (i - (per - 1) / 2) * 0.12, speed: d.speed, dmg: dm, pierce: (d.pierce || 1) + G.stats.pierce, kind: d.kind, life: 1.0, tags: d.tags, r: 0.25 });
        fired = true;
      }
      if (!fired) return false;
    } else if (d.type === 'proj') {
      const aim = aimDir(d.homing ? 16 : 20); if (!aim) return false;
      const n = 1 + extra;
      for (let i = 0; i < n; i++) {
        const a = aim.a + (i - (n - 1) / 2) * (d.spread || 0.14);
        let ox = 0, oy = 0;
        if (d.drones) { const s2 = i % 2 ? 1 : -1; ox = Math.cos(aim.a + s2 * 1.57) * 1.2; oy = Math.sin(aim.a + s2 * 1.57) * 1.2; }
        const o = { x: p.x + ox, y: p.y + oy, a, speed: d.speed, dmg: dm, pierce: (d.pierce || 1) + G.stats.pierce, kind: d.kind, color: d.color, life: 1.0, tags: d.tags, r: d.kind === 'orb' ? 0.3 : 0.25, homing: d.homing || 0, slow: d.slow || 0 };
        if (d.burn) o.burnHit = d.burn;
        if (d.explode) { const rad = d.explode * G.stats.area; o.pierce = 1; o.onHit = q => { explode(q.x, q.y, rad, dm, d.tags); play('Explosion0*', { vol: 0.35, gap: 0.08 }); }; }
        shoot(o);
      }
      fired = true;
    } else if (d.type === 'beam') {
      const used = new Set();
      for (let i = 0; i <= extra; i++) {
        const t = nearestBloon(p.x, p.y, d.range, used); if (!t) break;
        used.add(t);
        G.effects.push({ kind: 'line', x: p.x, y: p.y, x2: t.x, y2: t.y, t: 0, life: 0.12, color: d.color, w: 0.15 });
        G.effects.push({ kind: 'spark', x: t.x, y: t.y, r: 0.8, t: 0, life: 0.15, color: d.color });
        damage(t, dm, d.tags); fired = true;
      }
    } else if (d.type === 'psi') {
      const used = new Set();
      for (let i = 0; i <= extra; i++) {
        const t = nearestBloon(p.x, p.y, 16, used); if (!t) break;
        used.add(t);
        G.effects.push({ kind: 'ring', x: t.x, y: t.y, r: d.aoe * G.stats.area + t.r, t: 0, life: 0.3, color: d.color });
        hitArea(t.x, t.y, d.aoe * G.stats.area, dm, d.tags); fired = true;
      }
    } else if (d.type === 'cone') {
      const range = d.range * G.stats.area, aim = aimDir(range + 1); if (!aim) return false;
      const width = 0.45 + 0.08 * extra;
      for (let k = 0; k < 2 + extra; k++) G.effects.push({ kind: 'flame', x: p.x, y: p.y, a: aim.a + rnd(-width, width), sp: rnd(9, 13) * range / 5.5, t: 0, life: range / 11, s: rnd(0.4, 0.8) });
      G.hash.query(p.x, p.y, range + 2, _q);
      const list = _q.slice(); if (G.boss && !G.boss.dead) list.push(G.boss);
      for (const b of list) {
        if (b.dead) continue;
        const dx = b.x - p.x, dy = b.y - p.y, dd = Math.hypot(dx, dy);
        if (dd > range + b.r) continue;
        let da = Math.atan2(dy, dx) - aim.a; da = Math.atan2(Math.sin(da), Math.cos(da));
        if (Math.abs(da) < width + b.r / Math.max(dd, 1)) damage(b, dm * (1 + 0.15 * extra), d.tags, { quiet: true, burn: 1.5 });
      }
      fired = true;
    } else if (d.type === 'melee') {
      const t = nearestBloon(p.x, p.y, d.range + 2.5); if (!t) return false;
      const base = Math.atan2(t.y - p.y, t.x - p.x);
      for (let i = 0; i <= extra; i++) {
        const a = base + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.5;
        const go = () => {
          if (!G) return;
          const r = d.range * G.stats.area;
          G.effects.push({ kind: 'slash', x: G.player.x, y: G.player.y, a, r, arc: d.arc, t: 0, life: 0.18 });
          G.hash.query(G.player.x, G.player.y, r + 2, _q);
          const list = _q.slice(); if (G.boss && !G.boss.dead) list.push(G.boss);
          for (const b of list) {
            if (b.dead) continue;
            const dx = b.x - G.player.x, dy = b.y - G.player.y, dd = Math.hypot(dx, dy);
            if (dd > r + b.r) continue;
            let da = Math.atan2(dy, dx) - a; da = Math.atan2(Math.sin(da), Math.cos(da));
            if (Math.abs(da) < d.arc / 2 + b.r / Math.max(dd, 1)) { damage(b, dm, d.tags); if (d.stun && !b.isBoss) b.stunT = Math.max(b.stunT, d.stun); b.kx += Math.cos(a) * 6; b.ky += Math.sin(a) * 6; }
          }
          play('HitCeramic0*', { vol: 0.25, gap: 0.05, key: 'slash' });
        };
        i ? setTimeout(go, i * 110) : go();
      }
      fired = true;
    }
    if (fired) {
      sk.cd = cdOf(sk, d.cd);
      if (!R3.playerBusy()) R3.playerAnim('attack', Math.max(1, 0.5 / Math.max(0.12, sk.cd)));
    }
    return fired;
  },
  dart(sk) {
    const aim = aimDir(20); if (!aim) return false;
    const n = 1 + (lvAt(sk, 2) ? 1 : 0) + (lvAt(sk, 5) ? 1 : 0) + (lvAt(sk, 7) ? 2 : 0) + G.stats.proj;
    const pierce = 1 + (lvAt(sk, 4) ? 1 : 0) + (lvAt(sk, 7) ? 2 : 0) + G.stats.pierce;
    const dm = skillDmg(sk, (lvAt(sk, 3) ? 1.25 : 1) * (lvAt(sk, 7) ? 1.5 : 1));
    for (let i = 0; i < n; i++) {
      const a = aim.a + (i - (n - 1) / 2) * 0.11;
      shoot({ a, speed: 26, dmg: dm, pierce, kind: lvAt(sk, 7) ? 'bolt' : 'dart', life: 1.0, tags: sk.def.tags });
    }
    sk.cd = cdOf(sk, sk.def.cd * (lvAt(sk, 6) ? 0.7 : 1));
    return true;
  },
  boomer(sk) {
    const aim = aimDir(16); if (!aim) return false;
    const n = 1 + (lvAt(sk, 2) ? 1 : 0) + (lvAt(sk, 5) ? 1 : 0) + G.stats.proj;
    const pierce = 6 + (lvAt(sk, 4) ? 3 : 0) + G.stats.pierce * 2;
    const size = (lvAt(sk, 6) ? 1.3 : 1) * G.stats.area;
    const dm = skillDmg(sk, lvAt(sk, 3) ? 1.25 : 1);
    for (let i = 0; i < n; i++) {
      const a = aim.a + (i - (n - 1) / 2) * 0.5;
      shoot({ a, speed: 15, dmg: dm, pierce, kind: 'glaive', r: 0.45 * size, life: 1.6, tags: sk.def.tags, boomer: true, curve: (i % 2 ? -1 : 1) * 2.4, rehit: 0.4 });
    }
    sk.cd = cdOf(sk, sk.def.cd);
    return true;
  },
  bomb(sk) {
    const n = 1 + (lvAt(sk, 4) ? 1 : 0) + Math.floor(G.stats.proj / 2);
    let fired = false;
    const used = new Set();
    for (let i = 0; i < n; i++) {
      const t = nearestBloon(G.player.x, G.player.y, 18, used); if (!t) break;
      used.add(t);
      const a = Math.atan2(t.y - G.player.y, t.x - G.player.x);
      const rad = 2.2 * (lvAt(sk, 2) ? 1.25 : 1) * (lvAt(sk, 5) ? 1.25 : 1) * G.stats.area;
      const dm = skillDmg(sk, (lvAt(sk, 3) ? 1.3 : 1) * (lvAt(sk, 6) ? 1.4 : 1));
      shoot({ a, speed: 16, dmg: dm, pierce: 1, kind: 'bomb', r: 0.35, life: 1.4, tags: sk.def.tags, onHit: (p) => {
        explode(p.x, p.y, rad, dm, sk.def.tags, { moabMult: lvAt(sk, 7) ? 3 : 1 });
        if (lvAt(sk, 7)) for (let k = 0; k < 4; k++) { const aa = k * TAU / 4 + rnd(0.5); setTimeout(() => G && explode(p.x + Math.cos(aa) * rad * 0.9, p.y + Math.sin(aa) * rad * 0.9, rad * 0.55, dm * 0.5, sk.def.tags), 120); }
        play('Explosion0*', { vol: 0.45, gap: 0.06 });
      } });
      fired = true;
    }
    if (fired) sk.cd = cdOf(sk, sk.def.cd);
    return fired;
  },
  tack(sk) {
    if (!nearestBloon(G.player.x, G.player.y, 9)) return false;
    const n = 8 + (lvAt(sk, 2) ? 4 : 0) + (lvAt(sk, 5) ? 4 : 0) + G.stats.proj * 2;
    const dm = skillDmg(sk, lvAt(sk, 3) ? 1.25 : 1);
    const off = rnd(TAU);
    for (let i = 0; i < n; i++) shoot({ a: off + i * TAU / n, speed: 18, dmg: dm, pierce: 1 + (lvAt(sk, 4) ? 1 : 0) + G.stats.pierce, kind: 'tack', life: 0.42 * G.stats.area + 0.1, tags: sk.def.tags });
    if (lvAt(sk, 7)) { G.effects.push({ kind: 'ring', x: G.player.x, y: G.player.y, r: 5 * G.stats.area, t: 0, life: 0.4, color: '#ff6a1a' }); hitArea(G.player.x, G.player.y, 5 * G.stats.area, dm * 2, ['area', 'fire']); }
    sk.cd = cdOf(sk, sk.def.cd * (lvAt(sk, 6) ? 0.7 : 1));
    return true;
  },
  frost(sk) {
    const rad = 3.6 * (lvAt(sk, 2) ? 1.2 : 1) * (lvAt(sk, 5) ? 1.2 : 1) * G.stats.area;
    const dm = skillDmg(sk, (lvAt(sk, 3) ? 1.4 : 1) * (lvAt(sk, 6) ? 1.5 : 1));
    const fr = (lvAt(sk, 4) ? 1.5 : 1) * G.stats.dur;
    G.effects.push({ kind: 'frost', x: G.player.x, y: G.player.y, r: rad, t: 0, life: 0.5 });
    hitArea(G.player.x, G.player.y, rad, dm, sk.def.tags, { slow: 1.4 * fr, freeze: lvAt(sk, 7) ? 0.9 * fr : 0 });
    sk.cd = cdOf(sk, sk.def.cd);
    return true;
  },
  glue(sk) {
    const n = 1 + (lvAt(sk, 2) ? 1 : 0) + (lvAt(sk, 5) ? 1 : 0) + Math.floor(G.stats.proj / 2);
    const rad = 2.0 * (lvAt(sk, 4) ? 1.3 : 1) * G.stats.area;
    const dm = skillDmg(sk, (lvAt(sk, 3) ? 1.3 : 1) * (lvAt(sk, 7) ? 2 : 1));
    for (let i = 0; i < n; i++) {
      const t = nearestBloon(G.player.x, G.player.y, 14) || G.player;
      const x = t.x + rnd(-3, 3), y = t.y + rnd(-3, 3);
      G.hazards.push({ src: SRC, kind: 'glue', x, y, r: rad, dmg: dm, tick: 0.5, tt: 0, life: 4 * (lvAt(sk, 6) ? 1.5 : 1) * G.stats.dur, t: 0, tags: sk.def.tags, slow: 0.6 });
    }
    sk.cd = cdOf(sk, sk.def.cd);
    return true;
  },
  sniper(sk) {
    // target strongest bloon in view
    let best = null, bh = -1;
    const p = G.player;
    for (const b of G.bloons) { if (b.dead) continue; if ((b.x - p.x) ** 2 + (b.y - p.y) ** 2 > 26 * 26) continue; const h = b.hp + (b.def.moab ? 1e5 : 0); if (h > bh) { bh = h; best = b; } }
    if (G.boss && !G.boss.dead && (G.boss.x - p.x) ** 2 + (G.boss.y - p.y) ** 2 < 30 * 30) best = G.boss;
    if (!best) return false;
    const shots = 1 + (lvAt(sk, 6) ? 1 : 0);
    const dm = skillDmg(sk, (lvAt(sk, 2) ? 1.3 : 1) * (lvAt(sk, 5) ? 1.5 : 1));
    for (let s = 0; s < shots; s++) {
      const tgt = s === 0 ? best : nearestBloon(best.x, best.y, 10, new Set([best])) || best;
      const a = Math.atan2(tgt.y - p.y, tgt.x - p.x);
      G.effects.push({ kind: 'line', x: p.x, y: p.y, x2: tgt.x, y2: tgt.y, t: 0, life: 0.15, color: '#fff6c0', w: 0.12 });
      damage(tgt, dm, sk.def.tags, { moabMult: lvAt(sk, 7) ? 2 : 1 });
      if (lvAt(sk, 7) && !tgt.isBoss) tgt.stunT = 1;
      // pierce through behind
      const extra = (lvAt(sk, 3) ? 2 : 0) + G.stats.pierce;
      if (extra) shoot({ x: tgt.x, y: tgt.y, a, speed: 40, dmg: dm * 0.5, pierce: extra, kind: 'bolt', life: 0.4, tags: sk.def.tags, hits: new Set([tgt]) });
    }
    play('AttackSniperRifleHeavy0*', { vol: 0.35, gap: 0.05 });
    sk.cd = cdOf(sk, sk.def.cd * (lvAt(sk, 4) ? 0.7 : 1));
    return true;
  },
  shuriken(sk) {
    const aim = aimDir(18); if (!aim) return false;
    const n = 2 + (lvAt(sk, 2) ? 1 : 0) + (lvAt(sk, 5) ? 1 : 0) + (lvAt(sk, 7) ? 3 : 0) + G.stats.proj;
    const dm = skillDmg(sk, lvAt(sk, 3) ? 1.25 : 1);
    for (let i = 0; i < n; i++) shoot({ a: aim.a + rnd(-0.6, 0.6), speed: 20, dmg: dm, pierce: 2 + (lvAt(sk, 4) ? 1 : 0) + G.stats.pierce, kind: 'shuriken', life: 1.3, tags: sk.def.tags, homing: 9, critBonus: lvAt(sk, 6) ? 0.25 : 0 });
    sk.cd = cdOf(sk, sk.def.cd);
    return true;
  },
  fire(sk) {
    const range = 5.5 * (lvAt(sk, 2) ? 1.2 : 1) * (lvAt(sk, 6) ? 1.2 : 1) * G.stats.area;
    const aim = aimDir(range + 1); if (!aim) return false;
    const width = 0.45 * (lvAt(sk, 4) ? 1.2 : 1);
    const dm = skillDmg(sk, (lvAt(sk, 3) ? 1.3 : 1) * (lvAt(sk, 5) ? 1.3 : 1));
    const p = G.player;
    for (let k = 0; k < 2; k++) G.effects.push({ kind: 'flame', x: p.x, y: p.y, a: aim.a + rnd(-width, width), sp: rnd(9, 13) * range / 5.5, t: 0, life: range / 11, s: rnd(0.4, 0.8) });
    // cone damage
    G.hash.query(p.x, p.y, range + 2, _q);
    const list = _q.slice(); if (G.boss && !G.boss.dead) list.push(G.boss);
    for (const b of list) {
      if (b.dead) continue;
      const dx = b.x - p.x, dy = b.y - p.y, d = Math.hypot(dx, dy);
      if (d > range + b.r) continue;
      let da = Math.atan2(dy, dx) - aim.a; da = Math.atan2(Math.sin(da), Math.cos(da));
      if (Math.abs(da) < width + b.r / Math.max(d, 1)) damage(b, dm, sk.def.tags, { quiet: true, burn: 1.5 });
    }
    if (lvAt(sk, 7)) {
      if (!sk.state.phoenix) { sk.state.phoenix = { a: 0 }; }
    }
    sk.cd = cdOf(sk, sk.def.cd);
    return true;
  },
  lightning(sk) {
    const p = G.player;
    const start = nearestBloon(p.x, p.y, 14); if (!start) return false;
    const bolts = 1 + (lvAt(sk, 4) ? 1 : 0) + Math.floor(G.stats.proj / 2);
    const chains = 3 + (lvAt(sk, 2) ? 1 : 0) + (lvAt(sk, 5) ? 2 : 0) + G.stats.chain + G.stats.pierce;
    const dm = skillDmg(sk, lvAt(sk, 3) ? 1.3 : 1);
    const strikes = lvAt(sk, 7) ? 2 : 1;
    const hitAny = new Set();
    for (let b = 0; b < bolts; b++) {
      let cur = b === 0 ? start : nearestBloon(p.x, p.y, 14, hitAny);
      if (!cur) break;
      let px = p.x, py = p.y; const hit = new Set();
      for (let c = 0; c <= chains && cur; c++) {
        G.effects.push({ kind: 'bolt', x: px, y: py, x2: cur.x, y2: cur.y, t: 0, life: 0.18, seed: Math.random() });
        for (let s = 0; s < strikes; s++) damage(cur, dm, sk.def.tags);
        hit.add(cur); hitAny.add(cur); px = cur.x; py = cur.y;
        cur = nearestBloon(px, py, 6, hit);
      }
    }
    play('Lightning0*', { vol: 0.3, gap: 0.08 });
    sk.cd = cdOf(sk, sk.def.cd * (lvAt(sk, 6) ? 0.7 : 1));
    return true;
  },
  spike(sk) {
    const n = 1 + (lvAt(sk, 2) ? 1 : 0) + (lvAt(sk, 5) ? 1 : 0) + Math.floor(G.stats.proj / 2);
    const dm = skillDmg(sk, lvAt(sk, 4) ? 1.3 : 1);
    for (let i = 0; i < n; i++) {
      const t = nearestBloon(G.player.x, G.player.y, 12);
      let x, y;
      if (t) { x = lerp(G.player.x, t.x, rnd(0.4, 0.9)) + rnd(-1.5, 1.5); y = lerp(G.player.y, t.y, rnd(0.4, 0.9)) + rnd(-1.5, 1.5); }
      else { const a = rnd(TAU); x = G.player.x + Math.cos(a) * 3; y = G.player.y + Math.sin(a) * 3; }
      if (!G.arena.isWalk(x, y)) { x = G.player.x; y = G.player.y; }
      G.hazards.push({ src: SRC, kind: 'spikes', x, y, r: 0.9 * Math.sqrt(G.stats.area), dmg: dm, pierce: 8 + (lvAt(sk, 3) ? 5 : 0) + (lvAt(sk, 7) ? 10 : 0) + G.stats.pierce * 2, life: lvAt(sk, 7) ? 9999 : 8 * (lvAt(sk, 6) ? 1.5 : 1) * G.stats.dur, t: 0, tags: sk.def.tags, hits: new Map() });
    }
    // cap piles
    const piles = G.hazards.filter(h => h.kind === 'spikes');
    if (piles.length > 40) G.hazards.splice(G.hazards.indexOf(piles[0]), 1);
    sk.cd = cdOf(sk, sk.def.cd);
    return true;
  },
  mortar(sk) {
    const n = 2 + (lvAt(sk, 2) ? 1 : 0) + (lvAt(sk, 5) ? 1 : 0) + Math.floor(G.stats.proj / 2);
    const rad = 2.0 * (lvAt(sk, 3) ? 1.25 : 1) * G.stats.area;
    const dm = skillDmg(sk, lvAt(sk, 4) ? 1.3 : 1);
    let any = false;
    for (let i = 0; i < n; i++) {
      // pick a random visible bloon
      const vis = G.bloons.filter(b => !b.dead && Math.abs(b.x - G.player.x) < 16 && Math.abs(b.y - G.player.y) < 11);
      if (!vis.length && !(G.boss && !G.boss.dead)) break;
      const t = vis.length ? pick(vis) : G.boss;
      const x = t.x + rnd(-0.8, 0.8), y = t.y + rnd(-0.8, 0.8);
      G.effects.push({ kind: 'target', x, y, r: rad, t: 0, life: 0.55 });
      G.hazards.push({ src: SRC, kind: 'delayed', x, y, r: rad, dmg: dm, t: 0, life: 0.55, tags: sk.def.tags, stun: lvAt(sk, 7) ? 0.8 : 0 });
      any = true;
    }
    if (any) sk.cd = cdOf(sk, sk.def.cd * (lvAt(sk, 6) ? 0.7 : 1));
    return any;
  },
  heli(sk) {
    const n = 1 + (lvAt(sk, 3) ? 1 : 0) + (lvAt(sk, 6) ? 1 : 0);
    while (G.summons.filter(s => s.kind === 'heli').length < n) G.summons.push({ kind: 'heli', a: rnd(TAU), x: G.player.x, y: G.player.y, cd: 0, sk });
    const dm = skillDmg(sk, lvAt(sk, 4) ? 1.3 : 1);
    let any = false;
    for (const h of G.summons) {
      if (h.kind !== 'heli') continue;
      const t = nearestBloon(h.x, h.y, 13); if (!t) continue;
      const a = Math.atan2(t.y - h.y, t.x - h.x);
      if (lvAt(sk, 7)) { G.effects.push({ kind: 'line', x: h.x, y: h.y, x2: t.x, y2: t.y, t: 0, life: 0.08, color: '#ff4040', w: 0.1 }); damage(t, dm * 1.6, sk.def.tags, { quiet: true }); }
      else shoot({ x: h.x, y: h.y, a: a + rnd(-0.08, 0.08), speed: 30, dmg: dm, pierce: 1 + (lvAt(sk, 5) ? 1 : 0) + G.stats.pierce, kind: 'bullet', life: 0.6, tags: sk.def.tags, r: 0.15 });
      h.face = a; h.shotT = G.t; any = true;
    }
    sk.cd = cdOf(sk, sk.def.cd * (lvAt(sk, 2) ? 0.8 : 1));
    return any;
  },
  sentry(sk) {
    const n = 1 + (lvAt(sk, 2) ? 1 : 0) + (lvAt(sk, 5) ? 1 : 0);
    const dm = skillDmg(sk, lvAt(sk, 3) ? 1.3 : 1);
    for (let i = 0; i < n; i++) {
      const a = rnd(TAU), x = G.player.x + Math.cos(a) * 2, y = G.player.y + Math.sin(a) * 2;
      if (!G.arena.isWalk(x, y)) continue;
      G.summons.push({ kind: 'sentry', x, y, life: 10 * (lvAt(sk, 4) ? 1.5 : 1) * G.stats.dur, t: 0, cd: 0, rate: 0.45 * (lvAt(sk, 6) ? 0.7 : 1), dmg: dm, plasma: lvAt(sk, 7), sk, face: 0 });
    }
    const sentries = G.summons.filter(s => s.kind === 'sentry');
    while (sentries.length > 9) G.summons.splice(G.summons.indexOf(sentries.shift()), 1);
    sk.cd = cdOf(sk, sk.def.cd);
    return true;
  },
  plasma(sk) {
    const aim = aimDir(20); if (!aim) return false;
    const dm = skillDmg(sk, (lvAt(sk, 2) ? 1.25 : 1) * (lvAt(sk, 5) ? 1.3 : 1));
    const ways = lvAt(sk, 7) ? 3 : lvAt(sk, 6) ? 2 : 1;
    for (let i = 0; i < ways; i++) {
      const a = aim.a + (i - (ways - 1) / 2) * 0.16 + rnd(-0.05, 0.05);
      shoot({ a, speed: 32, dmg: dm, pierce: 1 + (lvAt(sk, 3) ? 1 : 0) + G.stats.pierce, kind: lvAt(sk, 7) ? 'sun' : 'plasma', life: 0.7, tags: sk.def.tags, r: 0.22 });
    }
    sk.cd = cdOf(sk, sk.def.cd * (lvAt(sk, 4) ? 0.8 : 1));
    return true;
  },
  brew(sk) {
    const dur = (4 + (lvAt(sk, 2) ? 1 : 0) + (lvAt(sk, 5) ? 1 : 0)) * G.stats.dur;
    G.brewPow = 1.35 + (lvAt(sk, 3) ? 0.1 : 0) + (lvAt(sk, 6) ? 0.1 : 0);
    G.player.buffT = lvAt(sk, 7) ? 1e9 : dur;
    G.effects.push({ kind: 'ring', x: G.player.x, y: G.player.y, r: 2.5, t: 0, life: 0.5, color: '#ff4fd8' });
    play('PotionBuff0*', { vol: 0.5 });
    sk.cd = lvAt(sk, 7) ? 1e9 : sk.def.cd - (lvAt(sk, 4) ? 1.5 : 0);
    return true;
  },
  farm(sk) {
    const n = 1 + (lvAt(sk, 2) ? 1 : 0) + (lvAt(sk, 5) ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const pos = G.arena.randomCellNear(G.player.x, G.player.y, 2, 6, 15); if (!pos) continue;
      G.pickups.push({ kind: 'banana', x: pos[0], y: pos[1], v: 6 * (lvAt(sk, 3) ? 1.3 : 1) * (lvAt(sk, 6) ? 1.3 : 1), xp: lvAt(sk, 7) ? 12 : 2, t: 0 });
    }
    sk.cd = sk.def.cd - (lvAt(sk, 4) ? 1 : 0);
    return true;
  },
  sub(sk) {
    const aim = aimDir(20); if (!aim) return false;
    const n = 1 + (lvAt(sk, 2) ? 1 : 0) + (lvAt(sk, 5) ? 1 : 0) + Math.floor(G.stats.proj / 2);
    const rad = 1.8 * (lvAt(sk, 3) ? 1.3 : 1) * G.stats.area;
    const dm = skillDmg(sk, lvAt(sk, 4) ? 1.3 : 1);
    for (let i = 0; i < n; i++) {
      let a = aim.a + (i - (n - 1) / 2) * 0.25;
      if (lvAt(sk, 7)) { const strong = G.bloons.filter(b => !b.dead).sort((x, y) => y.hp - x.hp)[i]; if (strong) a = Math.atan2(strong.y - G.player.y, strong.x - G.player.x); }
      shoot({ a, speed: 17, dmg: dm, pierce: 1, kind: 'torpedo', r: 0.3, life: 1.6, tags: sk.def.tags, onHit: p => explode(p.x, p.y, rad, dm, sk.def.tags, { color: '#7fe3ff' }) });
    }
    sk.cd = cdOf(sk, sk.def.cd * (lvAt(sk, 6) ? 0.7 : 1));
    return true;
  },
  desperado(sk) {
    const p = G.player;
    const shots = 2 + (lvAt(sk, 4) ? 1 : 0) + Math.floor(G.stats.proj / 2);
    const used = new Set(); let any = false;
    const dm = skillDmg(sk, lvAt(sk, 5) ? 1.4 : 1);
    for (let i = 0; i < shots; i++) {
      const t = G.manualAim ? null : nearestBloon(p.x, p.y, 17, used);
      const aim = t ? { a: Math.atan2(t.y - p.y, t.x - p.x) } : (i === 0 ? aimDir(17) : null);
      if (!aim) break;
      if (t) used.add(t);
      shoot({ a: aim.a + rnd(-0.04, 0.04), speed: 34, dmg: dm, pierce: 1 + (lvAt(sk, 3) ? 2 : 0) + G.stats.pierce, kind: 'bullet', life: 0.7, tags: sk.def.tags, r: 0.18,
        critBonus: lvAt(sk, 6) ? 0.25 : 0, ricochet: lvAt(sk, 7) ? 3 : 0 });
      any = true;
    }
    if (any) sk.cd = cdOf(sk, sk.def.cd * (lvAt(sk, 2) ? 0.7 : 1));
    return any;
  },
  buccaneer(sk) {
    const aim = aimDir(18); if (!aim) return false;
    const balls = 2 + (lvAt(sk, 4) ? 1 : 0) + Math.floor(G.stats.proj / 2);
    const dm = skillDmg(sk, lvAt(sk, 6) ? 1.4 : 1);
    const rad = 1.4 * G.stats.area;
    const mm = lvAt(sk, 7) ? 3 : 1;
    for (let i = 0; i < balls; i++) {
      const a = aim.a + (i - (balls - 1) / 2) * 0.22;
      shoot({ a, speed: 19, dmg: dm, pierce: 1, kind: 'bomb', r: 0.3, life: 1.1, tags: sk.def.tags, onHit: p2 => {
        explode(p2.x, p2.y, rad, dm, sk.def.tags, { moabMult: mm, burn: lvAt(sk, 5) ? 2 : 0, color: '#ffcc66' });
        play('Explosion0*', { vol: 0.3, gap: 0.08 });
      } });
    }
    const grapes = 3 + (lvAt(sk, 2) ? 3 : 0);
    for (let i = 0; i < grapes; i++) shoot({ a: aim.a + rnd(-0.5, 0.5), speed: 24, dmg: dm * 0.35, pierce: 1 + G.stats.pierce, kind: 'bullet', life: 0.5, tags: ['proj'], r: 0.15, moabMult: mm });
    sk.cd = cdOf(sk, sk.def.cd * (lvAt(sk, 3) ? 0.75 : 1));
    return true;
  },
  ace(sk) {
    if (!G.summons.some(s => s.kind === 'ace')) G.summons.push({ kind: 'ace', a: rnd(TAU), x: G.player.x, y: G.player.y, sk, bombT: 0, gzT: 8 });
    const ace = G.summons.find(s => s.kind === 'ace');
    const n = 8 + (lvAt(sk, 5) ? 4 : 0) + G.stats.proj * 2;
    const dm = skillDmg(sk);
    const off = rnd(TAU);
    for (let i = 0; i < n; i++) shoot({ x: ace.x, y: ace.y, a: off + i * TAU / n, speed: 20, dmg: dm, pierce: 2 + (lvAt(sk, 3) ? 2 : 0) + G.stats.pierce, kind: 'dart', life: 0.8, tags: sk.def.tags, homing: lvAt(sk, 4) ? 6 : 0 });
    ace.anim = 'attack';
    sk.cd = cdOf(sk, sk.def.cd * (lvAt(sk, 2) ? 0.75 : 1));
    return true;
  },
  dartling(sk) {
    const aim = aimDir(20); if (!aim) return false;
    const spread = lvAt(sk, 2) ? 0.08 : 0.2;
    const dm = skillDmg(sk, lvAt(sk, 5) ? 1.4 : 1);
    const n = 1 + (lvAt(sk, 6) ? 2 : 0);
    for (let i = 0; i < n; i++) shoot({ a: aim.a + rnd(-spread, spread) * (i ? 2.5 : 1), speed: 30, dmg: dm, pierce: 1 + G.stats.pierce, kind: 'bullet', life: 0.7, tags: sk.def.tags, r: 0.16 });
    sk.state.n = (sk.state.n || 0) + 1;
    if (lvAt(sk, 4) && sk.state.n % 12 === 0) {
      for (let k = -1; k <= 1; k++) shoot({ a: aim.a + k * 0.15, speed: 18, dmg: dm * 4, pierce: 1, kind: 'torpedo', r: 0.3, life: 1.2, tags: ['proj', 'area'], onHit: p2 => explode(p2.x, p2.y, 1.6 * G.stats.area, dm * 4, ['proj', 'area']) });
    }
    if (lvAt(sk, 7)) {
      sk.state.ray = (sk.state.ray || 0) - 1;
      if (sk.state.ray <= 0) {
        sk.state.ray = 3;
        const p = G.player, L = 22, ex = p.x + Math.cos(aim.a) * L, ey = p.y + Math.sin(aim.a) * L;
        G.effects.push({ kind: 'line', x: p.x, y: p.y, x2: ex, y2: ey, t: 0, life: 0.1, color: '#ff3030', w: 0.3 });
        const list = G.bloons.slice(); if (G.boss && !G.boss.dead) list.push(G.boss);
        for (const b of list) {
          if (b.dead) continue;
          const dx = b.x - p.x, dy = b.y - p.y, along = dx * Math.cos(aim.a) + dy * Math.sin(aim.a);
          if (along < 0 || along > L) continue;
          if (Math.abs(-dx * Math.sin(aim.a) + dy * Math.cos(aim.a)) < b.r + 0.4) damage(b, dm * 3, sk.def.tags, { quiet: true });
        }
      }
    }
    sk.cd = cdOf(sk, sk.def.cd * (lvAt(sk, 3) ? 0.8 : 1));
    return true;
  },
  mermonkey(sk) {
    const aim = aimDir(16); if (!aim) return false;
    const n = 1 + (lvAt(sk, 3) ? 1 : 0) + Math.floor(G.stats.proj / 2);
    const dm = skillDmg(sk, (lvAt(sk, 4) ? 1.4 : 1) * (lvAt(sk, 7) ? 2 : 1));
    const size = (lvAt(sk, 6) ? 1.3 : 1) * G.stats.area;
    for (let i = 0; i < n; i++) {
      shoot({ a: aim.a + (i - (n - 1) / 2) * 0.3, speed: 15, dmg: dm, pierce: 6 + (lvAt(sk, 2) ? 3 : 0) + G.stats.pierce * 2, kind: 'wave', r: 0.7 * size, life: 1.1, tags: sk.def.tags,
        slow: lvAt(sk, 5) ? 1.2 : 0, freeze: lvAt(sk, 7) ? 0.8 : 0 });
    }
    play('HitIce0*', { vol: 0.25, gap: 0.2 });
    sk.cd = cdOf(sk, sk.def.cd);
    return true;
  },
  village(sk) {
    if (!G.summons.some(s => s.kind === 'village')) G.summons.push({ kind: 'village', x: G.player.x - 2, y: G.player.y + 1, sk });
    sk.cd = 1e9;
    return true;
  },
  beast(sk) {
    // each upgrade drops the matching beast: raptors grow into a T-Rex then a Giganotosaurus, a bird of prey joins at level 3
    const roster = BEAST_ROSTER[Math.min(7, sk.lv)];
    let mine = G.summons.filter(s => s.kind === 'beast');
    for (const sm of mine.slice(roster.length)) G.summons.splice(G.summons.indexOf(sm), 1);
    mine = mine.slice(0, roster.length);
    roster.forEach((sp, i) => {
      let sm = mine[i];
      if (!sm) { sm = { kind: 'beast', x: G.player.x + rnd(-1.5, 1.5), y: G.player.y + rnd(-1.5, 1.5), sk, cd: 0, face: 0 }; G.summons.push(sm); G.effects.push({ kind: 'ring', x: sm.x, y: sm.y, r: 2.4, t: 0, life: 0.5, color: '#ffe39a' }); }
      if (sm.sp !== sp) { if (sm.sp) G.effects.push({ kind: 'ring', x: sm.x, y: sm.y, r: 2.4, t: 0, life: 0.5, color: '#ffe39a' }); sm.sp = sp; sm.bird = BEASTS[sp].bird; }
    });
    sk.cd = 1;
    return true;
  },
};

// ---------------------------------------------------------------- hero abilities (press R)
function abilDmg(m = 1) { const h = G.skills.find(k => k.hero); return skillDmg(h, m) * G.stats.heroDmg * 4; }
function abilTarget(maxd = 22) { const b = nearestBloon(G.player.x, G.player.y, maxd); return b ? [b.x, b.y] : [G.player.x + Math.cos(G.player.face > 0 ? 0 : Math.PI) * 5, G.player.y]; }
function strongest(maxd = 26) { let best = null, bh = -1; const p = G.player; for (const b of G.bloons.concat(G.boss && !G.boss.dead ? [G.boss] : [])) { if (b.dead || (b.x - p.x) ** 2 + (b.y - p.y) ** 2 > maxd * maxd) continue; const h = b.maxhp + (b.isBoss ? 1e9 : b.def.moab ? 1e6 : 0); if (h > bh) { bh = h; best = b; } } return best; }
const HERO_ABIL = {
  quincy: { name: 'Storm of Arrows', icon: 'StormOfArrowsAA', cd: 30, desc: 'Rains arrows over the area around the nearest bloons.', fn() {
    const [tx, ty] = abilTarget(); for (let i = 0; i < 36; i++) setTimeout(() => { if (!G) return; const x = tx + rnd(-4.5, 4.5), y = ty + rnd(-4.5, 4.5); G.effects.push({ kind: 'spark', x, y, r: 0.7, t: 0, life: 0.2, color: '#ffe9a0' }); hitArea(x, y, 1.2, abilDmg(0.35), ['proj'], { quiet: true }); }, i * 55); } },
  gwen: { name: 'Cocktail of Fire', icon: 'CocktailOfFireAA', cd: 25, desc: 'Lobs a firebomb that leaves a burning pool.', fn() {
    const [x, y] = abilTarget(); explode(x, y, 3, abilDmg(1), ['area', 'fire'], { burn: 3, color: '#ff7a20' });
    G.hazards.push({ src: 'hero', kind: 'glue', x, y, r: 3.2, dmg: abilDmg(0.25), tick: 0.4, tt: 0, life: 6, t: 0, tags: ['area', 'fire'], fire: true }); } },
  striker: { name: 'Concussive Shell', icon: 'ConcussiveShellAA', cd: 25, desc: 'A huge shell that stuns everything it hits.', fn() {
    const [x, y] = abilTarget(); explode(x, y, 4.5, abilDmg(1.5), ['area'], { stun: 3, color: '#ffd060' }); G.effects.push({ kind: 'expl', x, y, r: 3, t: 0, life: 0.8 }); } },
  obyn: { name: 'Brambles', icon: 'BramblesAA', cd: 25, desc: 'Grows thorny brambles around you that pop anything passing.', fn() {
    const p = G.player; for (let i = 0; i < 8; i++) { const a = i * TAU / 8, x = p.x + Math.cos(a) * 4, y = p.y + Math.sin(a) * 4; if (G.arena.isWalk(x, y)) G.hazards.push({ src: 'hero', kind: 'spikes', x, y, r: 1.1, dmg: abilDmg(0.4), pierce: 40, t: 0, life: 14, tags: ['trap'], hits: new Map() }); } } },
  rosalia: { name: 'Kinetic Charge', icon: 'KineticChargeAA', cd: 40, desc: 'Fires a volley of homing grenades.', fn() {
    for (let i = 0; i < 12; i++) setTimeout(() => { if (!G) return; const t = nearestBloon(G.player.x, G.player.y, 20); const a = t ? Math.atan2(t.y - G.player.y, t.x - G.player.x) + rnd(-0.5, 0.5) : rnd(TAU);
      shoot({ a, speed: 16, dmg: abilDmg(0.6), pierce: 1, kind: 'bomb', r: 0.3, life: 1.6, homing: 7, tags: ['area'], src: 'hero', onHit: q => explode(q.x, q.y, 2, abilDmg(0.6), ['area'], { color: '#ff9a40' }) }); }, i * 70); } },
  churchill: { name: 'Armor Piercing Shells', icon: 'ArmorPiercingShellsAA', cd: 35, desc: 'Double hero damage for 10 seconds.', fn() { G.buf.heroDmg = 10; } },
  benjamin: { name: 'Syphon Funding', icon: 'SyphonfundsIconAA', cd: 45, desc: 'Hacks nearby bloons down a layer and pockets the cash.', fn() {
    const p = G.player; let n = 0; for (const b of G.bloons.slice()) { if (b.dead || b.def.moab || (b.x - p.x) ** 2 + (b.y - p.y) ** 2 > 144) continue; damage(b, b.hp + 0.01, ['proj'], { quiet: true }); n++; }
    const cash = 40 + n * 3; G.gold += cash; G.goldEarned += cash; rs('hero').gold += cash; G.texts.push({ x: p.x, y: p.y - 1.5, s: '+$' + cash, t: 0, life: 1.4, gold: true });
    G.effects.push({ kind: 'ring', x: p.x, y: p.y, r: 12, t: 0, life: 0.6, color: '#40ff80' }); } },
  pat: { name: 'Rallying Roar', icon: 'RallyingRoarAA', cd: 40, desc: '+50% damage for you and your towers for 10 seconds.', fn() { G.buf.dmg = 10; G.effects.push({ kind: 'ring', x: G.player.x, y: G.player.y, r: 6, t: 0, life: 0.6, color: '#ff8a3d' }); } },
  ezili: { name: 'MOAB Hex', icon: 'MoabHexAA', cd: 35, desc: 'Curses the strongest bloon, draining its health.', fn() {
    const b = strongest(); if (!b) return false; b.hexT = 8; b.hexD = b.isBoss ? b.maxhp * 0.012 : Math.max(abilDmg(0.5), b.maxhp * 0.08); G.effects.push({ kind: 'ring', x: b.x, y: b.y, r: b.r + 2, t: 0, life: 0.6, color: '#c040ff' }); } },
  adora: { name: 'Ball of Light', icon: 'BallofLightAA', cd: 30, desc: 'A sun orb that burns through everything in its path.', fn() {
    const [tx, ty] = abilTarget(), p = G.player; shoot({ a: Math.atan2(ty - p.y, tx - p.x), speed: 9, dmg: abilDmg(0.5), pierce: 999, kind: 'sun', r: 1.2, life: 3, rehit: 0.25, tags: ['proj'], src: 'hero', spr: 'BallofLightAA' }); } },
  brickell: { name: 'Naval Tactics', icon: 'NavalTacticsAA', cd: 40, desc: '+60% attack speed for you and your towers for 10 seconds.', fn() { G.buf.as = 10; G.effects.push({ kind: 'ring', x: G.player.x, y: G.player.y, r: 6, t: 0, life: 0.6, color: '#3d9bff' }); } },
  etienne: { name: 'UCAV', icon: 'UcavAA', cd: 45, desc: 'Calls in two more drones for 15 seconds.', fn() {
    const h = G.skills.find(k => k.hero); for (let i = 0; i < 2; i++) G.summons.push({ kind: 'drone', sk: h, x: G.player.x, y: G.player.y, a: i * 3 + 1.5, face: 0, life: 15, t: 0, ucav: true }); } },
  sauda: { name: 'Leaping Sword', icon: 'LeapingSwordAA', cd: 20, desc: 'Leaps onto the nearest bloons with a huge slash.', fn() {
    const t = nearestBloon(G.player.x, G.player.y, 14); if (!t) return false; const p = G.player;
    if (G.arena.isWalk(t.x, t.y)) { p.x = t.x; p.y = t.y; } p.inv = Math.max(p.inv, 0.5);
    G.effects.push({ kind: 'slash', x: p.x, y: p.y, a: 0, r: 3.5, arc: TAU, t: 0, life: 0.3 }); explode(p.x, p.y, 3.5, abilDmg(1.4), ['area'], { color: '#ffffff' }); } },
  psi: { name: 'Psychic Blast', icon: 'PsychicBlastAA', cd: 35, desc: 'A psychic shockwave that damages and stuns everything nearby.', fn() {
    const p = G.player; hitArea(p.x, p.y, 9, abilDmg(1), ['area'], { stun: 2.5 }); G.effects.push({ kind: 'ring', x: p.x, y: p.y, r: 9, t: 0, life: 0.6, color: '#ff4fd8' }); shake(0.3); } },
  geraldo: { name: 'Shooty Turret', icon: 'GeraldoShopAA', cd: 35, desc: 'Places a turret that shoots for 20 seconds.', fn() {
    const p = G.player, h = G.skills.find(k => k.hero); G.summons.push({ kind: 'sentry', sk: null, x: p.x + 1, y: p.y + 1, t: 0, life: 20, cd: 0, rate: 0.3, dmg: abilDmg(0.15), face: 0, plasma: false, src: 'hero' }); } },
  corvus: { name: 'Soul Harvest', icon: 'SoulHarvestAA', cd: 40, desc: 'Rips the souls out of nearby bloons and heals you.', fn() {
    const p = G.player; let n = 0; G.hash.query(p.x, p.y, 10, _q); for (const b of _q.slice()) if (!b.dead && (b.x - p.x) ** 2 + (b.y - p.y) ** 2 < 100) { damage(b, abilDmg(0.8), ['area'], { quiet: true }); n++; }
    const heal = Math.min(G.stats.maxhp - p.hp, n * 1.5 + 10); p.hp += heal; rs('hero').heal += heal; G.effects.push({ kind: 'ring', x: p.x, y: p.y, r: 10, t: 0, life: 0.6, color: '#ff3050' }); } },
  silas: { name: 'Frozen Cascade', icon: 'FrozenCascadeAA', cd: 30, desc: 'Freezes and damages every bloon around you.', fn() {
    const p = G.player; hitArea(p.x, p.y, 10, abilDmg(0.8), ['area', 'frost'], { freeze: 3, slow: 5 }); G.effects.push({ kind: 'frost', x: p.x, y: p.y, r: 10, t: 0, life: 0.6 }); } },
};
const ABIL_SND = {"quincy": "ActivatedStormOfArrows", "gwen": "ActivatedMolotov", "striker": "ActivatedConcussiveBlast", "obyn": "ActivatedBrambles", "rosalia": ["ActivatedRosaliaKineticChargeNoVO01", "Activated3RosaliaVO01"], "churchill": "ActivatedAPShells", "benjamin": "ActivatedSyphonFunding", "pat": "ActivatedRallyingRoar", "ezili": "ActivatedMoabHex", "adora": "ActivatedBallOfLight", "brickell": "ActivatedNavalTactics", "etienne": "ActivatedUcav", "sauda": "ActivatedLeapingSword", "psi": "ActivatedPsychicBlast", "geraldo": "ActivatedGenericRecharge", "corvus": "Activated7CorvusVO01", "silas": ["ActivatedSilasFrozenBurialNoVO", "Activated10SilasVO01"]};
function useAbility() {
  if (!G || G.state !== 'play') return;
  const A = HERO_ABIL[G.ch.id]; if (!A || G.abilCd > 0) return;
  SRC = 'hero';
  if (A.fn() === false) { toast('No target for ' + A.name, '#cbbfa8'); return; }
  G.abilCd = A.cd * (1 - Math.min(0.6, G.stats.abilCdr || 0)); toast(A.name + '!', '#7fd8ff'); META.ability();
  for (const k of [].concat(ABIL_SND[G.ch.id] || [])) play(k, { vol: 1, gap: 0, bus: /VO|^Activated(?!.*NoVO)/.test(k) ? 'vo' : undefined });
}
// ---------------------------------------------------------------- bloons
function hpScale(def) { return G.chaos.hp * (1 + G.t / 240) * (def.moab ? 1 + G.t / 400 : 1) * Math.pow(1.6, G.loop); }
function spawnBloon(type, pos, parent) {
  const def = BLOONS[type];
  const p = G.player;
  if (!pos) { pos = G.arena.randomCellNear(p.x, p.y, 17, 28); if (!pos) return null; }
  const hpS = hpScale(def);
  const b = {
    type, def, x: pos[0], y: pos[1], r: def.r, hp: def.hp * hpS, maxhp: def.hp * hpS, jit: def.sm ? 0.96 + rnd(0.08) : 0.92 + rnd(0.16), anc: [], quiet: 0,
    slowT: 0, frozenT: 0, stunT: 0, burnT: 0, burnD: 0, hitT: 0, dead: false, wob: rnd(TAU), elite: !!def.elite, kx: 0, ky: 0,
  };
  b.spd = bloonSpd(def) * b.jit;
  if (type === 'ddt') b.camo = true;   // DDTs are always camo
  if (parent) { b.x += rnd(-0.4, 0.4); b.y += rnd(-0.4, 0.4); b.slowT = parent.slowT; }
  if (!parent && !def.moab && BLOON_ORDER.includes(type) && Math.random() < 0.005 && !G.bloons.some(o => !o.dead && o.def.golden)) {
    const gd = BLOONS.golden, hp = gd.hp * hpScale(gd);
    Object.assign(b, { type: 'golden', def: gd, r: gd.r, hp, maxhp: hp, spd: gd.spd, hopT: 1.5, hop: 0, camo: false, regrow: false, fort: false });
    toast('A GOLDEN BLOON appeared!', '#ffd700'); play('LegendsItemCollected', { vol: 0.7 });
  }
  G.bloons.push(b);
  return b;
}
function damage(b, dmg, tags, opts = {}) {
  if (b.dead || b.phased) return;
  let d = dmg;
  // crit
  let crit = false;
  if (Math.random() < G.stats.crit + (opts.critBonus || 0)) { d *= G.stats.critMult; crit = true; }
  if (b.def && b.def.resist) for (const t of tags) if (b.def.resist[t]) d *= b.def.resist[t];
  if ((b.def && b.def.moab) || b.isBoss) { d *= (opts.moabMult || 1); const ps = G.skillOf && G.skillOf[SRC]; if (ps && ps.lv >= 3) d *= Math.pow(1.25, pathCount(ps, 'B')); }
  if (b.isBoss && (b.shield || b.shieldT > 0)) d *= 0.25;
  rs().dmg += Math.min(d, Math.max(0, b.hp)); if (opts.burn) b.burnSrc = SRC;
  b.hp -= d; b.hitT = 0.08; b.quiet = 0;
  if (!opts.quiet || Math.random() < 0.15) {
    sfxHit(b);
    if ((b.isBoss || (b.def && b.def.moab) || b.type === 'ceramic' || b.type === 'lead') && Math.random() < 0.5)
      G.effects.push({ kind: 'spark', x: b.x + rnd(-b.r, b.r) * 0.6, y: b.y + rnd(-b.r, b.r) * 0.6, h: b.isBoss || b.def.moab ? 1.4 : 0.8, r: b.isBoss || b.def.moab ? 0.9 : 0.5, t: 0, life: 0.14, color: b.type === 'lead' ? '#dfe6ee' : b.type === 'ceramic' ? '#ffb070' : '#fff1b0' });
  }
  G.dmgDealt += d;
  if (opts.burn) { b.burnT = Math.max(b.burnT, opts.burn); b.burnD = Math.max(b.burnD, d * 0.25); }
  if (SETTINGS.dmgNumbers && ((!opts.quiet && (d >= 3 || Math.random() < 0.3)) || (crit && d >= 3) || (opts.burnTick && Math.random() < 0.3) || Math.random() < 0.04)) {
    const kind = crit ? 'crit' : opts.burnTick ? 'burn' : (tags || []).includes('frost') ? 'frost' : (tags || []).includes('lightning') ? 'lightning' : 'normal';
    G.texts.push({ x: b.x + rnd(-0.3, 0.3), y: b.y - b.r, s: crit ? '' + Math.round(d) + '!' : '' + Math.max(1, Math.round(d)), t: 0, life: 0.6, crit, kind });
  }
  if (b.hp <= 0) b.isBoss ? killBoss(b) : popBloon(b, -b.hp);
}
// give a freshly spawned bloon its camo / regrow / fortified properties
function setProps(b, { camo, regrow, fort } = {}) {
  if (!b || b.def.golden) return b;
  if (camo) b.camo = true;
  if (regrow && !b.def.moab) b.regrow = true;
  if (fort && CAN_FORT[b.type] && !b.fort) { b.fort = true; b.hp *= 2; b.maxhp *= 2; }
  return b;
}
function rollProps(type) {
  const t = G.t + G.chaosIdx * 60 + G.loop * 400, moab = BLOONS[type].moab;
  return {
    camo: !moab && t > 200 && Math.random() < Math.min(0.3, (t - 200) / 1200),
    regrow: !moab && t > 140 && Math.random() < Math.min(0.35, (t - 140) / 900),
    fort: !!CAN_FORT[type] && t > (moab ? 500 : 280) && Math.random() < Math.min(moab ? 0.4 : 0.35, (t - (moab ? 500 : 280)) / 1000),
  };
}
// regrow: after a few seconds without taking damage, a regrow bloon grows back the layer it last lost
function regrowTick(b, dt) {
  if (!b.regrow || !b.anc.length) return;
  b.quiet += dt;
  if (b.quiet < REGROW_T) return;
  b.quiet = 0;
  const up = b.anc.pop(), def = BLOONS[up.type], hp = def.hp * hpScale(def) * (up.fort ? 2 : 1);
  b.type = up.type; b.def = def; b.r = def.r; b.spd = bloonSpd(def) * b.jit; b.fort = up.fort;
  b.maxhp = hp; b.hp = hp;
  G.effects.push({ kind: 'ring', x: b.x, y: b.y, r: b.r * 2.2, t: 0, life: 0.35, color: '#ff7ab8' });
}
function popBloon(b, overflow) {
  b.dead = true;
  rs().pops++; META.pop(b);
  G.pops++; if (b.def.moab || !b.def.kids.length) G.kills++;
  G.effects.push({ kind: 'pop', x: b.x, y: b.y, r: b.r, t: 0, life: 0.16, color: b.def.color });
  // pops are worth gold (BTD: $1 per layer popped; blimps pay a bounty)
  // golden bloon: 10x a ceramic's gold (2) and xp (5)
  const gold = (b.def.golden ? 150 : b.def.moab ? { moab: 40, bfb: 120, ddt: 90, zomg: 400 }[b.type] || 40 : b.type === 'ceramic' || b.def.ds ? 2 : 1) * goldMult();
  if (b.def.golden) {
    play('PopGolden', { vol: 1 }); G.texts.push({ x: b.x, y: b.y - b.r, s: '+$' + Math.round(gold), t: 0, life: 1.4, gold: true });
    for (let i = 0; i < 8; i++) G.effects.push({ kind: 'coinpop', x: b.x + rnd(-1, 1), y: b.y + rnd(-1, 1), t: 0, life: 0.9 });
  }
  if (b.def.magma) G.hazards.push({ kind: 'magma', x: b.x, y: b.y, r: 1.6, t: 0, life: 3, tick: 0 });
  G.gold += gold; G.goldEarned += gold;
  { const vm = goldMult() / G.stats.gold; const extra = gold - gold / vm; rs().gold += gold - extra; if (extra > 0) rs('village').gold += extra; }
  if (b.def.moab) {
    shake(0.35);
    G.effects.push({ kind: 'expl', x: b.x, y: b.y, r: b.r * 1.4, t: 0, life: 0.7 });
    for (let i = 0; i < 6; i++) G.effects.push({ kind: 'coinpop', x: b.x + rnd(-1.5, 1.5), y: b.y + rnd(-1.5, 1.5), t: 0, life: 0.8 });
    G.texts.push({ x: b.x, y: b.y - b.r, s: '+$' + Math.round(gold), t: 0, life: 1.2, gold: true });
    play(b.type === 'zomg' || b.type === 'bfb' ? 'ZomgDestroyed01' : 'MoabDestroyed0*', { vol: 0.9, gap: 0.1, key: 'moabdie' });
    if (Math.random() < 0.6) setTimeout(() => voice('MoabDestroyed'), 500);
  } else if (b.type === 'ceramic') { play('CeramicDestroyed0*', { vol: 0.45, gap: 0.05 }); sfxPop(false); }
  else sfxPop(false);
  // souls
  const xp = b.def.xp;
  if (b.def.golden) { for (let i = 0; i < 10; i++) dropSoul(b.x + rnd(-1.2, 1.2), b.y + rnd(-1.2, 1.2), xp / 10); }
  else if (b.def.moab) { for (let i = 0; i < 8; i++) dropSoul(b.x + rnd(-1.5, 1.5), b.y + rnd(-1.5, 1.5), xp / 8); if (!b.minion) G.pickups.push({ kind: 'chest', x: b.x, y: b.y, t: 0 }); }
  else if (Math.random() < 0.55 || xp > 1) dropSoul(b.x, b.y, xp);
  if (!b.def.kids.length && !b.def.moab && Math.random() < 0.01) G.pickups.push({ kind: 'heart', x: b.x, y: b.y, t: 0 });   // 1% per bloon fully popped
  // shed a layer: the same bloon turns into its next layer down (blimps are simply destroyed)
  if (!b.def.moab && b.def.kids.length) {
    const k = b.def.kids[0][0], def = BLOONS[k], hp = def.hp * hpScale(def);
    if (b.regrow) b.anc.push({ type: b.type, fort: !!b.fort });
    b.type = k; b.def = def; b.r = def.r; b.spd = bloonSpd(def) * b.jit; b.fort = false; b.quiet = 0;
    b.maxhp = hp; b.hp = hp - overflow * 0.5; b.dead = false; b.hitT = 0;
    if (b.hp <= 0) popBloon(b, -b.hp);
  }
}
function dropSoul(x, y, v) { G.pickups.push({ kind: 'soul', x, y, v, t: 0, vx: rnd(-2, 2), vy: rnd(-2, 2) }); }

function spawnDirector(dt) {
  if (G.boss && !G.boss.dead) { G.spawnBudget += dt * 0.5; } // trickle during boss
  const t = G.t;
  const rate = (1.6 + t / 22 + Math.pow(t / 100, 1.6)) * G.chaos.rate * (1 + 0.3 * G.loop);
  G.spawnBudget += rate * dt;
  checkMilestones();
  if (G.bloons.length > 420) return;
  const avail = BLOON_ORDER.filter(k => UNLOCK_T[k] <= t + G.chaosIdx * 25);
  while (G.spawnBudget > 1) {
    // weighted toward newest tiers
    const idx = Math.min(avail.length - 1, Math.floor(Math.pow(Math.random(), 0.75) * avail.length));
    const type = avail[idx];
    const groupN = Math.max(1, Math.min(8, Math.round(rnd(2, 6) / Math.sqrt(COST[type]))));
    const cost = Math.sqrt(COST[type]) * groupN;
    if (cost > G.spawnBudget + 6) { G.spawnBudget -= 1; setProps(spawnBloon(avail[0]), rollProps(avail[0])); continue; }
    G.spawnBudget -= cost;
    const pos = G.arena.randomCellNear(G.player.x, G.player.y, 17, 26);
    if (!pos) break;
    const props = rollProps(type);   // a group shares its properties, like a BTD round
    for (let i = 0; i < groupN; i++) setProps(spawnBloon(type, [pos[0] + rnd(-1, 1), pos[1] + rnd(-1, 1)]), props);
  }
}
function checkMilestones() {
  // elites at quarter progress
  const prog = (G.pops - G.goalStart) / (G.goal - G.goalStart);
  const eliteTypes = ['moab', 'ddt', 'bfb'];
  if (G.elitesSpawned < 3 && prog >= (G.elitesSpawned + 1) * 0.2) {
    const e = setProps(spawnBloon(eliteTypes[G.elitesSpawned]), { fort: G.t + G.loop * 400 > 500 && Math.random() < 0.5 });
    if (e) { G.elitesSpawned++; toast(`ELITE: ${e.type.toUpperCase()} incoming!`, '#ff6a6a'); voice(e.type === 'moab' ? 'MoabWarning' : e.type === 'bfb' ? 'BfbWarning' : 'DdtWarning'); e.pickupChest = true; }
  }
  if (!(G.boss && !G.boss.dead) && prog >= 1) spawnBoss();
}


// ---------------------------------------------------------------- boss (Soulstone-style telegraphed attacks)
function spawnBoss() {
  const def = BOSSES[(G.mapIdx + G.chaosIdx + G.loop) % BOSSES.length];
  const pos = G.arena.randomCellNear(G.player.x, G.player.y, 12, 18) || [G.player.x + 10, G.player.y];
  const hp = def.hp * G.chaos.hp * (1 + G.t / 600) * Math.pow(1.7, G.loop);
  G.boss = { isBoss: true, def, x: pos[0], y: pos[1], r: def.r, hp, maxhp: hp, spd: def.spd, dead: false, hitT: 0, slowT: 0, frozenT: 0, stunT: 0, burnT: 0, burnD: 0, atkT: 3, phase: 1, wob: 0, kx: 0, ky: 0, shield: false,
    skulls: [0.75, 0.5, 0.25], blimpSkull: rint(0, 2), dashAtSpawn: G.dashesUsed || 0 };
  G.bossIntro = 3;
  play(BOSS_SFX[def.id][0], { vol: 1 });
  shake(0.6);
}
const SKULL_SFX = { bloonarius: 'BossBloonariusVomit', lych: 'BossLychEtherealize', vortex: 'VortexTornado0*', dreadbloon: 'BossDreadBloonReArmour', phayze: 'BossPhayzeSummonPortal', blastapopoulos: 'BossBlastapopoulosFormRocks0*' };
function bossSkull(b, idx) {
  const p = G.player, id = b.def.id;
  shake(0.7); b.anim = 'attack'; b.shieldT = 1.5;
  play(SKULL_SFX[id], { vol: 1, gap: 0 }); play('MoabDestroyed01', { vol: 0.4 });
  G.effects.push({ kind: 'ring', x: b.x, y: b.y, r: b.r + 6, t: 0, life: 0.7, color: b.def.color });
  const ring = (n, rad, f) => { for (let i = 0; i < n; i++) { const a = i * TAU / n + rnd(0.3), x = b.x + Math.cos(a) * rad, y = b.y + Math.sin(a) * rad; if (G.arena.isWalk(x, y)) f(x, y, a); } };
  const tier = () => pick(G.t > 300 || G.loop ? ['ceramic', 'rainbow', 'lead', 'zebra'] : ['zebra', 'black', 'white', 'pink', 'purple']);
  let what = '';
  if (id === 'bloonarius') {   // spews a wave of slime-coated bloons and slime puddles
    ring(22, b.r + 1.5, (x, y) => { const m = spawnBloon(tier(), [x, y], b); if (m) m.slime = true; });
    for (let i = 0; i < 5; i++) { const a = rnd(TAU), d = rnd(3, 9); G.hazards.push({ kind: 'slime', x: b.x + Math.cos(a) * d, y: b.y + Math.sin(a) * d, r: 2.2, t: 0, life: 8 }); }
    what = 'Bloonarius spews slime bloons!';
  } else if (id === 'lych') {   // summons Mini-Lychs that feed it while alive
    ring(2, b.r + 3, (x, y) => { const m = spawnBloon('lychmini', [x, y], b); if (m) { m.minion = true; m.lych = b; } });
    what = 'Lych raises Mini-Lychs!';
  } else if (id === 'vortex') {   // gale of wind-boosted bloons + a gust that shoves you away
    ring(14, b.r + 2, (x, y) => { const m = spawnBloon(tier(), [x, y], b); if (m) m.wind = true; });
    const a = Math.atan2(p.y - b.y, p.x - b.x); for (let i = 0; i < 12; i++) moveCircle(p, Math.cos(a) * 0.5, Math.sin(a) * 0.5);
    what = 'Vortex unleashes a gale!';
  } else if (id === 'dreadbloon') {   // armoured rock bloons
    ring(5, b.r + 2, (x, y) => spawnBloon('rock', [x, y], b));
    what = 'Dreadbloon launches Rock Bloons!';
  } else if (id === 'phayze') {   // phasing bloons that blink in and out of reality
    ring(12, b.r + 2, (x, y) => { const m = spawnBloon(tier(), [x + rnd(-6, 6), y + rnd(-6, 6)], b); if (m) m.phase = true; });
    what = 'Phayze tears open reality!';
  } else {   // blastapopoulos: molten rock bloons that leave magma behind
    ring(5, b.r + 2, (x, y) => spawnBloon('magma', [x, y], b));
    what = 'Blastapopoulos hurls molten rocks!';
  }
  if (idx === b.blimpSkull) {
    const types = G.loop >= 2 ? ['bfb', 'zomg', 'ddt'] : G.loop >= 1 ? ['bfb', 'ddt', 'moab'] : ['moab', 'moab', 'ddt'];
    ring(3, b.r + 4, (x, y) => { const m = spawnBloon(pick(types), [x, y], b); if (m) m.minion = true; });
    what += '  + 3 blimps!';
    voice('MoabWarning');
  }
  toast('☠ ' + what, '#ff6a6a');
}
function bossAI(b, dt) {
  const p = G.player;
  while (b.skulls.length && b.hp / b.maxhp <= b.skulls[0]) bossSkull(b, 3 - b.skulls.length), b.skulls.shift();
  if (b.shieldT > 0) b.shieldT -= dt;
  // living Mini-Lychs feed the Lych
  if (b.def.id === 'lych') { const minis = G.bloons.filter(o => !o.dead && o.type === 'lychmini').length; if (minis) b.hp = Math.min(b.maxhp, b.hp + b.maxhp * 0.004 * minis * dt); }
  if (b.hp < b.maxhp * 0.5 && b.phase === 1) { b.phase = 2; toast(`${b.def.name} is ENRAGED!`, '#ff4040'); b.spd *= 1.3; }
  bossMechanic(b, dt);
  b.atkT -= dt;
  if (b.atkT > 0) return;
  const enr = (b.phase === 2 ? 0.7 : 1) * (1 - 0.18 * (3 - b.skulls.length));   // each skull broken makes it attack faster
  const roll = Math.random();
  b.anim = 'attack';
  if (roll < 0.35) { // slam circles at/around player
    const n = b.phase === 2 ? 5 : 3;
    for (let i = 0; i < n; i++) {
      const x = p.x + (i ? rnd(-5, 5) : p.vx * 0.5), y = p.y + (i ? rnd(-5, 5) : p.vy * 0.5);
      G.hazards.push({ kind: 'bossSlam', x, y, r: 2.6, t: 0, life: 1.25, dmg: 22 * G.chaos.dmg });
    }
    b.atkT = 2.6 * enr;
  } else if (roll < 0.6) { // radial orb barrage
    const n = b.phase === 2 ? 22 : 14, off = rnd(TAU);
    for (let w = 0; w < (b.phase === 2 ? 2 : 1); w++)
      setTimeout(() => { if (!G || b.dead) return; for (let i = 0; i < n; i++) { const a = off + (i + w * 0.5) * TAU / n; G.eproj.push({ x: b.x, y: b.y, vx: Math.cos(a) * 7, vy: Math.sin(a) * 7, r: 0.45, life: 4, dmg: 14 * G.chaos.dmg }); } }, w * 450);
    b.atkT = 2.8 * enr;
  } else if (roll < 0.8 || b.def.ability === 'spawn') { // summon bloons
    const types = G.t > 300 ? ['ceramic', 'rainbow', 'lead'] : ['zebra', 'black', 'pink'];
    for (let i = 0; i < (b.phase === 2 ? 10 : 6); i++) { const a = i * TAU / 6; spawnBloon(pick(types), [b.x + Math.cos(a) * (b.r + 1), b.y + Math.sin(a) * (b.r + 1)]); }
    if (b.def.ability === 'spawn' && Math.random() < 0.3) spawnBloon('moab', [b.x, b.y]);
    G.effects.push({ kind: 'ring', x: b.x, y: b.y, r: b.r + 2, t: 0, life: 0.5, color: b.def.color });
    b.atkT = 3.2 * enr;
  } else { // charge / blink
    const a = Math.atan2(p.y - b.y, p.x - b.x);
    b.charge = { a, t: 0, tele: 0.9, dur: 0.75 };
    G.hazards.push({ kind: 'chargeLine', x: b.x, y: b.y, a, len: 14, w: b.r * 1.6, t: 0, life: 0.9 });
    b.atkT = 3.4 * enr;
  }
}
// signature boss mechanics: Lych drains your buffs, Phayze blinds you, Vortex shorts out your towers
function bossMechanic(b, dt) {
  const p = G.player, id = b.def.id, ph2 = b.phase === 2;
  b.mechT = (b.mechT ?? 8) - dt;
  if (b.mechWarn) { b.mechWarn -= dt; if (b.mechWarn > 0) return; b.mechWarn = 0; }
  if (b.mechT > 0) return;
  if (id === 'lych') {
    b.mechT = ph2 ? 10 : 14;
    const stole = [];
    if (p.buffT > 0 && p.buffT < 1e8) { p.buffT = 0; stole.push('brew'); }
    for (const k in G.buf) if (G.buf[k] > 0) { G.buf[k] = 0; stole.push(k); }
    G.drainT = ph2 ? 8 : 6; b.drainFx = G.drainT;
    b.hp = Math.min(b.maxhp, b.hp + b.maxhp * (0.03 + 0.01 * stole.length));
    G.effects.push({ kind: 'ring', x: p.x, y: p.y, r: 3, t: 0, life: 0.6, color: '#a040ff' });
    play('BossLychEtherealize', { vol: 0.7 }); toast('☠ The Lych drains your power!' + (stole.length ? ' (buffs stolen)' : ''), '#c070ff');
  } else if (id === 'phayze') {
    b.mechT = ph2 ? 12 : 16;
    G.blindT = ph2 ? 5 : 4; G.blindMax = G.blindT;
    G.effects.push({ kind: 'ring', x: b.x, y: b.y, r: 16, t: 0, life: 0.8, color: '#33ddff' });
    play('BossPhayzeSummonPortal', { vol: 0.7 }); toast('☠ Phayze warps reality — you are blinded!', '#33ddff');
  } else if (id === 'vortex') {
    b.mechT = ph2 ? 10 : 13;
    G.towerStunT = ph2 ? 4 : 3;
    for (const t of Object.values(G.towerPos)) G.effects.push({ kind: 'bolt', x: b.x, y: b.y, x2: t.x, y2: t.y, t: 0, life: 0.4 });
    for (const sm of G.summons) G.effects.push({ kind: 'bolt', x: b.x, y: b.y, x2: sm.x, y2: sm.y, t: 0, life: 0.4 });
    G.effects.push({ kind: 'ring', x: b.x, y: b.y, r: 18, t: 0, life: 0.7, color: '#9fd6ff' });
    play('VortexTornado0*', { vol: 0.7 }); toast('☠ Vortex shorts out your towers!', '#9fd6ff');
  } else b.mechT = 99;
}
function killBoss(b) {
  b.dead = true; G.bossDone = true; G.bossKills++; META.bossKill(b);
  shake(1);
  for (let i = 0; i < 30; i++) dropSoul(b.x + rnd(-3, 3), b.y + rnd(-3, 3), 6 * (1 + G.loop));
  G.pickups.push({ kind: 'chest', x: b.x, y: b.y, t: 0, free: true });
  // first kill sets the best time; then the run continues with tougher bloons and a stronger next boss
  if (G.bossKills === 1) { const key = `${G.arena.def.id}_${G.chaosIdx}`, best = BEST[key]; if (!best || G.t < best) { BEST[key] = G.t; G.bestThisRun = G.t; try { localStorage.setItem('bss_best', JSON.stringify(BEST)); } catch (e) { } } }
  // clear the arena and open Soulstone-style portals: continue (new random arena) or end the run
  G.portals = [];   // stops spawning until a portal is chosen
  for (const o of G.bloons) if (!o.dead) { o.dead = true; G.effects.push({ kind: 'pop', x: o.x, y: o.y, r: o.r, t: 0, life: 0.16, color: o.def.color }); }
  G.eproj.length = 0; G.hazards = G.hazards.filter(h => h.kind === 'spikes' || h.kind === 'glue');
  for (const q of G.pickups) if (q.kind === 'soul') q.vac = true;
  setTimeout(() => G && toast(`${b.def.name} DEFEATED!  Stand in a portal and press E`, '#ffe39a'), 600);
  setTimeout(() => {
    if (!G) return;
    const P = G.player, spots = [[-3.5, -2], [3.5, -2], [-4, 2], [4, 2], [0, -4], [0, 4]].map(([dx, dy]) => [P.x + dx, P.y + dy]).filter(([x, y]) => G.arena.free(x, y, 1));
    const a = spots[0] || [P.x - 3, P.y], c = spots.find(q => Math.hypot(q[0] - a[0], q[1] - a[1]) > 4) || [P.x + 3, P.y];
    G.portals = [{ kind: 'continue', x: a[0], y: a[1], t: 0 }, { kind: 'end', x: c[0], y: c[1], t: 0 }];
    play('BossPhayzeWarp', { vol: 0.8 });
  }, 2600);
  for (let i = 0; i < 6; i++) setTimeout(() => G && G.effects.push({ kind: 'boom', x: b.x + rnd(-2, 2), y: b.y + rnd(-2, 2), r: rnd(2, 4), t: 0, life: 0.5, color: '#fff' }), i * 120);
  play(BOSS_SFX[b.def.id][1], { vol: 1 });
  G.effects.push({ kind: 'expl', x: b.x, y: b.y, r: b.r * 1.6, t: 0, life: 0.9 });
  setTimeout(() => voice('MoabDestroyed'), 900);
  setTimeout(() => { if (G && G.boss === b) G.boss = null; }, 2500);
}

// ---------------------------------------------------------------- player
function tryDash() {
  if (!G || G.state !== 'play') return;
  const p = G.player;
  if ((p.dashN ?? 1) < 1 || p.dashT > 0) return;
  let [dx, dy] = moveAxis();
  if (!dx && !dy) { dx = p.face; }
  const l = Math.hypot(dx, dy); p.dashX = dx / l; p.dashY = dy / l;
  p.dashT = 0.18; p.inv = Math.max(p.inv, 0.3);
  p.dashN = (p.dashN ?? 1) - 1; if (p.dashCd <= 0) p.dashCd = 2.2 * (1 - (G.stats.dashCdr || 0)); META.dash();
  play('UIPropMagicWoosh', { vol: 0.45, gap: 0.05 });
}
function moveCircle(o, dx, dy) {
  const A = G.arena;
  if (A.free(o.x + dx, o.y, o.r)) o.x += dx;
  if (A.free(o.x, o.y + dy, o.r)) o.y += dy;
}
function hurtPlayer(dmg) {
  const p = G.player;
  if (p.inv > 0 || G.state !== 'play') return;
  const d = Math.max(1, dmg - G.stats.armor);
  p.hp -= d; p.inv = 0.45; p.hurtT = 0.25;
  shake(0.25);
  G.texts.push({ x: p.x, y: p.y - 1, s: '-' + Math.round(d), t: 0, life: 0.7, hurt: true });
  play('ShieldDamaged0*', { vol: 0.55, gap: 0.12, key: 'hurt' });
  if (p.hp <= 0) { p.hp = 0; endRun(false); }
}
function gainXp(v) {
  G.xp += v * G.stats.xp * G.chaos.xp;
  while (G.xp >= G.xpNext) {
    G.xp -= G.xpNext; G.level++; G.xpNext = xpFor(G.level); G.pendingLevels++;
    play('TowerUpgrade', { vol: 0.7, gap: 0.3 }); R3.playerAnim('upgrade'); if (G.level % 3 === 0) voice('Upgrade');
  }
  if (G.pendingLevels > 0 && G.state === 'play') openLevelUp();
}

// ---------------------------------------------------------------- update
function update(dt) {
  const p = G.player, s = G.stats;
  G.t += dt;
  popBudget = Math.max(0, popBudget - dt * 30);
  // movement
  let [mx, my] = moveAxis();
  const ml = Math.hypot(mx, my);
  const spd = G.ch.spd * s.speed * (p.slowT > 0 ? 0.55 : 1);
  p.slowT = (p.slowT || 0) - dt;
  if (ml > 1) { mx /= ml; my /= ml; }
  p.vx = lerp(p.vx, mx * spd, Math.min(1, dt * 14)); p.vy = lerp(p.vy, my * spd, Math.min(1, dt * 14));
  if (mx) p.face = mx > 0 ? 1 : -1;
  if (p.dashT > 0) { p.dashT -= dt; moveCircle(p, p.dashX * 30 * dt, p.dashY * 30 * dt); if (Math.random() < 0.8) G.effects.push({ kind: 'ghost', x: p.x, y: p.y, t: 0, life: 0.25, face: p.face }); }
  else moveCircle(p, p.vx * dt, p.vy * dt);
  p.inv -= dt; p.hurtT -= dt; p.buffT -= dt;
  G.abilCd -= dt; for (const k in G.buf) G.buf[k] -= dt; G.drainT -= dt; G.blindT -= dt; G.towerStunT -= dt;
  if (p.dashN === undefined) p.dashN = s.dashes;
  if (p.dashN < s.dashes) { p.dashCd -= dt; if (p.dashCd <= 0) { p.dashN++; p.dashCd = p.dashN < s.dashes ? 2.2 * (1 - (s.dashCdr || 0)) : 0; } } else p.dashCd = 0;
  META.tick(dt);
  if (p.hp < s.maxhp) rs('hero').heal += Math.min(s.maxhp - p.hp, s.regen * dt);
  p.hp = Math.min(s.maxhp, p.hp + s.regen * dt);

  // flow field
  G.flowT -= dt;
  if (G.flowT <= 0) { G.arena.computeFlow(p.x, p.y); G.flowT = 0.25; }

  if (G.grace > 0) G.grace -= dt;
  if (G.portals) {
    for (const pt of G.portals) {
      pt.t += dt;
      pt.near = pt.t > 0.8 && Math.hypot(p.x - pt.x, p.y - pt.y) < 2.2;
      // walking in no longer triggers it: press E while standing in the portal
      if (pt.near && G.useKey) {
        G.useKey = false;
        if (pt.kind === 'continue') { continueRun(); return; }
        G.portals = null; endRun(true, true); return;
      }
    }
    G.useKey = false;
  } else if (G.grace <= 0) spawnDirector(dt);
  G.chestT -= dt;
  if (G.chestT <= 0) {
    G.chestT = 45;
    const pos = G.arena.randomCellNear(p.x, p.y, 7, 16);
    if (pos && G.pickups.filter(q => q.kind === 'chest').length < 4) { G.pickups.push({ kind: 'chest', x: pos[0], y: pos[1], t: 0 }); toast('A chest appeared!', '#ffcf5a'); }
  }

  // tower companions stand in a ring around the hero (towers whose skill is a summon/aura don't need one)
  { const comps = G.skills.filter(k => !k.hero && !NO_TOWER[k.id]);
    comps.forEach((k, i) => {
      const a = i * TAU / comps.length + G.t * 0.25, rr = 2.4 + (comps.length > 4 ? 0.5 : 0);
      const tx = p.x + Math.cos(a) * rr, ty = p.y + Math.sin(a) * rr, t = G.towerPos[k.id];
      if (!t) G.towerPos[k.id] = { x: tx, y: ty }; else { const kk = Math.min(1, dt * 4); t.x += (tx - t.x) * kk; t.y += (ty - t.y) * kk; }
    }); }
  // skills
  for (const sk of G.skills) {
    if (G.towerStunT > 0 && !sk.hero) continue;   // Vortex static storm
    sk.cd -= dt;
    if (sk.cd <= 0) {
      // tower skills launch from their tower beside the hero, not from the hero
      const tp = !sk.hero && sk.id !== 'brew' && G.towerPos[sk.id], px = p.x, py = p.y;   // the brew buff stays on the hero
      if (tp) { p.x = tp.x; p.y = tp.y; }
      CUR_SK = sk; SRC = sk.hero ? 'hero' : sk.id;
      let ok; try { ok = CAST[sk.id](sk); } finally { CUR_SK = null; if (tp) { p.x = px; p.y = py; } }
      if (!ok) sk.cd = 0.15; else { sk.fired = (sk.fired || 0) + 1; if (sk.paragon && sk.cd < 1e8) sk.cd *= 0.6; }
    }
  }
  // phoenix orbit (Dragon's Breath lv7)
  const fs = hasSkill('fire');
  if (fs && fs.state.phoenix) {
    const ph = fs.state.phoenix; ph.a += dt * 1.6; ph.x = p.x + Math.cos(ph.a) * 4; ph.y = p.y + Math.sin(ph.a) * 4;
    ph.cd = (ph.cd || 0) - dt; SRC = 'fire';
    if (ph.cd <= 0) { ph.cd = 0.2; hitArea(ph.x, ph.y, 1.6, skillDmg(fs, 2), ['area', 'fire'], { burn: 2 }); }
  }
  // glaive lord orbit
  const bs = hasSkill('boomer');
  if (bs && lvAt(bs, 7)) {
    bs.state.oa = (bs.state.oa || 0) + dt * 4;
    bs.state.ocd = (bs.state.ocd || 0) - dt; SRC = 'boomer';
    if (bs.state.ocd <= 0) { bs.state.ocd = 0.15; for (let i = 0; i < 2; i++) { const a = bs.state.oa + i * Math.PI; hitArea(p.x + Math.cos(a) * 2.6, p.y + Math.sin(a) * 2.6, 0.7, skillDmg(bs, 0.7), ['proj'], { quiet: true }); } }
  }

  // rebuild hash
  G.hash.clear();
  for (const b of G.bloons) if (!b.dead) G.hash.add(b);

  // bloons
  const A = G.arena;
  for (const b of G.bloons) {
    if (b.dead) continue;
    b.slowT -= dt; b.frozenT -= dt; b.stunT -= dt; b.hitT -= dt; b.wob += dt * 4;
    regrowTick(b, dt);
    if (b.hexT > 0) { b.hexT -= dt; b.hexAcc = (b.hexAcc || 0) + dt; if (b.hexAcc > 0.5) { b.hexAcc = 0; SRC = 'hero'; damage(b, b.hexD * 0.5, ['area'], { quiet: true }); if (b.dead) continue; } }
    if (b.burnT > 0) { b.burnT -= dt; b.burnAcc = (b.burnAcc || 0) + dt; if (b.burnAcc > 0.33) { b.burnAcc = 0; SRC = b.burnSrc || 'hero'; damage(b, b.burnD, ['fire'], { quiet: true, burnTick: true }); if (b.dead) continue; } }
    if (b.def.golden) {   // golden bloons hop away like in BTD6
      if (b.hop > 0) { b.hop -= dt * 2.2; if (b.hop < 0) b.hop = 0; }
      b.hopT -= dt;
      if (b.hopT <= 0) { b.hopT = rnd(1.2, 2.2); const pos = A.randomCellNear(b.x, b.y, 3, 6, 10); if (pos) { b.x = pos[0]; b.y = pos[1]; b.hop = 1; } }
      continue;
    }
    if (b.phase) { b.phaseT = (b.phaseT || rnd(2)) - dt; if (b.phaseT <= 0) { b.phased = !b.phased; b.phaseT = b.phased ? 1.2 : 2.2; } }
    if (b.frozenT > 0 || b.stunT > 0) continue;
    let sp = b.spd * (b.slowT > 0 ? 0.45 : 1) * (b.wind ? 1.7 : 1);
    const dx = p.x - b.x, dy = p.y - b.y, d = Math.hypot(dx, dy);
    let ux, uy;
    if (d < 5) { ux = dx / (d || 1); uy = dy / (d || 1); }
    else { [ux, uy] = A.flowDir(b.x, b.y); if (!ux && !uy) { ux = dx / d; uy = dy / d; } }
    // bloons pass straight through each other (no separation)
    const vx = ux * sp * dt + b.kx * dt, vy = uy * sp * dt + b.ky * dt;
    b.kx *= 0.9; b.ky *= 0.9;
    const ox = b.x, oy = b.y;
    moveCircle(b, vx, vy);
    if (b.x === ox && b.y === oy && (vx || vy)) { b.x += vx * 0.3; b.y += vy * 0.3; } // unstick (they're balloons)
    // contact
    if (d < b.r + p.r) hurtPlayer(b.def.dmg * G.chaos.dmg);
    // DDTs are too fast to dodge their shots, so they also pulse a damaging shock ring around themselves
    if (b.type === 'ddt') {
      b.auraT = (b.auraT ?? rnd(0.5, 1.5)) - dt;
      if (b.auraT <= 0) {
        b.auraT = 1.6;
        G.effects.push({ kind: 'ring', x: b.x, y: b.y, r: DDT_AURA, t: 0, life: 0.45, color: '#ff4040' });
        G.effects.push({ kind: 'boom', x: b.x, y: b.y, r: DDT_AURA * 0.7, t: 0, life: 0.3, color: '#ff3a3a' });
        if (d < DDT_AURA + p.r) hurtPlayer(10 * G.chaos.dmg);
        play('Explosion0*', { vol: 0.15, gap: 0.25 });
      }
    }
    // blimps fire back: MOAB/DDT 2 shots, BFB a 5-shot fan, ZOMG a full ring
    if (b.def.moab && b.type !== 'lychmini' || b.type === 'lychmini') {
      b.shootT = (b.shootT ?? rnd(1, 2.5)) - dt;
      if (b.shootT <= 0 && d < 18) {
        b.shootT = b.type === 'zomg' ? 3.2 : b.type === 'bfb' ? 2.8 : 2.2;
        const a0 = Math.atan2(dy, dx), dmg = (b.type === 'zomg' ? 14 : b.type === 'bfb' ? 12 : 9) * G.chaos.dmg, sp = 8;
        const shots = b.type === 'zomg' ? Array.from({ length: 16 }, (_, i) => a0 + i * TAU / 16) : b.type === 'bfb' ? [-0.5, -0.25, 0, 0.25, 0.5].map(o => a0 + o) : [a0 - 0.12, a0 + 0.12];
        for (const a of shots) G.eproj.push({ x: b.x + Math.cos(a) * b.r, y: b.y + Math.sin(a) * b.r, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: 0.35, life: 3.5, dmg });
        play('ThrowObject01', { vol: 0.25, gap: 0.2 }) || play('Explosion0*', { vol: 0.12, gap: 0.3 });
      }
    }
  }
  // boss
  const B = G.boss;
  if (B && !B.dead) {
    if (G.bossIntro > 0) G.bossIntro -= dt;
    B.hitT -= dt; B.wob += dt * 2;
    if (B.hexT > 0) { B.hexT -= dt; B.hexAcc = (B.hexAcc || 0) + dt; if (B.hexAcc > 0.5) { B.hexAcc = 0; SRC = 'hero'; damage(B, B.hexD * 0.5, ['area'], { quiet: true }); } }
    if (B.burnT > 0) { B.burnT -= dt; B.burnAcc = (B.burnAcc || 0) + dt; if (B.burnAcc > 0.33) { B.burnAcc = 0; damage(B, B.burnD, ['fire'], { quiet: true }); } }
    if (B.charge) {
      const c = B.charge; c.t += dt;
      if (c.t > c.tele) { const v = 22 * dt; B.x += Math.cos(c.a) * v; B.y += Math.sin(c.a) * v; if (!A.isWalk(B.x, B.y)) { B.x -= Math.cos(c.a) * v; B.y -= Math.sin(c.a) * v; c.t = 99; } }
      if (c.t > c.tele + c.dur) B.charge = null;
    } else {
      bossAI(B, dt);
      const dx = p.x - B.x, dy = p.y - B.y, d = Math.hypot(dx, dy);
      if (d > 4) {
        let [ux, uy] = A.flowDir(B.x, B.y); if (!ux && !uy) { ux = dx / d; uy = dy / d; }
        B.x += ux * B.spd * dt; B.y += uy * B.spd * dt;
      }
    }
    if (Math.hypot(p.x - B.x, p.y - B.y) < B.r + p.r) hurtPlayer(30 * G.chaos.dmg);
    if (G.drainT > 0 && B.def.id === 'lych' && Math.random() < dt * 20) G.effects.push({ kind: 'line', x: B.x, y: B.y, x2: p.x, y2: p.y, t: 0, life: 0.1, color: '#b050ff', w: 0.2 });
  }
  if (G.towerStunT > 0) for (const t of Object.values(G.towerPos)) if (Math.random() < dt * 6) G.effects.push({ kind: 'spark', x: t.x + rnd(-0.5, 0.5), y: t.y + rnd(-0.5, 0.5), h: 1.2, r: 0.5, t: 0, life: 0.15, color: '#9fd6ff' });

  // projectiles
  for (const pr of G.projs) {
    pr.t += dt; pr.life -= dt; SRC = pr.src || 'hero';
    if (pr.boomer) {
      const back = pr.t > 0.55;
      const a = Math.atan2(pr.vy, pr.vx) + pr.curve * dt;
      let sp = Math.hypot(pr.vx, pr.vy);
      if (back) { const dx = p.x - pr.x, dy = p.y - pr.y, dd = Math.hypot(dx, dy); if (dd < 0.8) pr.life = 0; const ta = Math.atan2(dy, dx); const na = a + Math.atan2(Math.sin(ta - a), Math.cos(ta - a)) * Math.min(1, dt * 8); pr.vx = Math.cos(na) * sp; pr.vy = Math.sin(na) * sp; }
      else { pr.vx = Math.cos(a) * sp; pr.vy = Math.sin(a) * sp; }
      pr.rot += dt * 18;
    }
    if (pr.homing) {
      const t = nearestBloon(pr.x, pr.y, 7, pr.hits);
      if (t) { const a = Math.atan2(pr.vy, pr.vx), ta = Math.atan2(t.y - pr.y, t.x - pr.x); const na = a + Math.atan2(Math.sin(ta - a), Math.cos(ta - a)) * Math.min(1, dt * pr.homing); const sp = Math.hypot(pr.vx, pr.vy); pr.vx = Math.cos(na) * sp; pr.vy = Math.sin(na) * sp; }
      pr.rot += dt * 20;
    } else if (!pr.boomer) pr.rot = Math.atan2(pr.vy, pr.vx);
    pr.x += pr.vx * dt; pr.y += pr.vy * dt;
    if (!A.isWalk(pr.x, pr.y) && pr.kind !== 'glaive') { if (pr.onHit) pr.onHit(pr); pr.life = 0; continue; }
    // hits
    G.hash.query(pr.x, pr.y, pr.r + 3, _q);
    const list = _q; if (B && !B.dead) list.push(B);
    for (const b of list) {
      if (b.dead || pr.life <= 0) continue;
      if ((b.x - pr.x) ** 2 + (b.y - pr.y) ** 2 > (b.r + pr.r) ** 2) continue;
      if (pr.hits.has(b)) { if (!pr.rehit) continue; if (G.t - pr.hits.get(b) < pr.rehit) continue; }
      if (pr.hits instanceof Set) pr.hits.add(b); else pr.hits.set(b, G.t);
      if (pr.onHit) { pr.onHit(pr); pr.life = 0; break; }
      damage(b, pr.dmg, pr.tags, { critBonus: pr.critBonus, moabMult: pr.moabMult, burn: pr.burnHit || 0 });
      if (pr.slow) b.slowT = Math.max(b.slowT, pr.slow);
      if (pr.freeze && !b.isBoss && !(b.def && (b.def.moab || b.def.frostImmune))) b.frozenT = Math.max(b.frozenT, pr.freeze);
      b.kx += pr.vx * 0.04; b.ky += pr.vy * 0.04;
      if (--pr.pierce <= 0) {
        if (pr.ricochet > 0) {
          pr.ricochet--; pr.pierce = 1;
          const nt = nearestBloon(pr.x, pr.y, 9, pr.hits instanceof Set ? pr.hits : null);
          if (nt) { const a = Math.atan2(nt.y - pr.y, nt.x - pr.x), sp = Math.hypot(pr.vx, pr.vy); pr.vx = Math.cos(a) * sp; pr.vy = Math.sin(a) * sp; pr.life = Math.max(pr.life, 0.5); G.effects.push({ kind: 'spark', x: pr.x, y: pr.y, r: 0.5, t: 0, life: 0.15, color: '#ffd84a' }); continue; }
        }
        pr.life = 0; break;
      }
    }
  }
  // boomerangs need Map-based hit memory for re-hits
  G.projs = G.projs.filter(pr => pr.life > 0);
  for (const pr of G.projs) if (pr.rehit && pr.hits instanceof Set) pr.hits = new Map();

  // enemy projectiles
  for (const e of G.eproj) {
    e.x += e.vx * dt; e.y += e.vy * dt; e.life -= dt;
    if (Math.hypot(e.x - p.x, e.y - p.y) < e.r + p.r * 0.8) { hurtPlayer(e.dmg); e.life = 0; }
  }
  G.eproj = G.eproj.filter(e => e.life > 0);

  // hazards
  for (const h of G.hazards) {
    h.t += dt; SRC = h.src || 'hero';
    if (h.kind === 'slime') { if (Math.hypot(p.x - h.x, p.y - h.y) < h.r) p.slowT = 0.3; }
    else if (h.kind === 'magma') { h.tick -= dt; if (h.tick <= 0 && Math.hypot(p.x - h.x, p.y - h.y) < h.r + p.r * 0.5) { h.tick = 0.5; hurtPlayer(8 * G.chaos.dmg); } }
    else if (h.kind === 'glue') {
      h.tt -= dt;
      if (h.tt <= 0) { h.tt = h.tick; hitArea(h.x, h.y, h.r, h.dmg, h.tags, h.fire ? { burn: 1.5, quiet: true } : { slow: 0.6, quiet: true }); }
    } else if (h.kind === 'spikes') {
      G.hash.query(h.x, h.y, h.r + 1, _q);
      for (const b of _q) {
        if (b.dead || h.pierce <= 0) continue;
        if ((b.x - h.x) ** 2 + (b.y - h.y) ** 2 < (b.r + h.r) ** 2) {
          const last = h.hits.get(b); if (last !== undefined && h.t - last < 0.5) continue;
          h.hits.set(b, h.t); damage(b, h.dmg, h.tags); h.pierce--;
        }
      }
      if (h.pierce <= 0) h.life = 0;
    } else if (h.kind === 'delayed' && h.t >= h.life) {
      explode(h.x, h.y, h.r, h.dmg, h.tags, { stun: h.stun }); play('Explosion0*', { vol: 0.4, gap: 0.06 });
    } else if (h.kind === 'bossSlam' && h.t >= h.life) {
      G.effects.push({ kind: 'boom', x: h.x, y: h.y, r: h.r, t: 0, life: 0.4, color: '#ff3030' }); shake(0.3);
      if (Math.hypot(p.x - h.x, p.y - h.y) < h.r + p.r * 0.5) hurtPlayer(h.dmg);
    }
  }
  G.hazards = G.hazards.filter(h => h.t < h.life);

  // summons
  G.summons = G.summons.filter(sm => !sm.dead);
  for (const sm of G.summons) {
    SRC = sm.src || (sm.sk ? (sm.sk.hero ? 'hero' : sm.sk.id) : 'hero');
    if (sm.life && sm.kind !== 'sentry') { sm.t = (sm.t || 0) + dt; if (sm.t > sm.life) { sm.dead = true; continue; } }
    if (G.towerStunT > 0 && !(sm.sk && sm.sk.hero) && sm.src !== 'hero') continue;   // Vortex: towers short out
    if (sm.kind === 'drone') {
      const drs = G.summons.filter(x => x.kind === 'drone'), idx = drs.indexOf(sm);
      sm.a = (sm.a || 0) + dt * 1.6; const ang = G.t * 1.6 + idx * TAU / drs.length;
      sm.x = lerp(sm.x, p.x + Math.cos(ang) * 1.8, Math.min(1, dt * 6)); sm.y = lerp(sm.y, p.y + Math.sin(ang) * 1.8, Math.min(1, dt * 6));
      continue;
    }
    if (sm.kind === 'heli') {
      const idx = G.summons.filter(x => x.kind === 'heli').indexOf(sm);
      sm.a += dt * 1.3; const ang = sm.a + idx * TAU / 3;
      const ox = sm.x, oy = sm.y;
      sm.x = lerp(sm.x, p.x + Math.cos(ang) * 3.2, Math.min(1, dt * 5)); sm.y = lerp(sm.y, p.y + Math.sin(ang) * 3.2, Math.min(1, dt * 5));
      // nose follows the flight path unless it just fired at something
      if (!(G.t - (sm.shotT || -9) < 0.6) && (sm.x - ox) ** 2 + (sm.y - oy) ** 2 > 1e-6) sm.face = Math.atan2(sm.y - oy, sm.x - ox);
    } else if (sm.kind === 'sentry') {
      sm.t += dt; sm.cd -= dt;
      if (sm.cd <= 0) {
        const t = nearestBloon(sm.x, sm.y, 9);
        if (t) { const a = Math.atan2(t.y - sm.y, t.x - sm.x); sm.face = a; sm.anim = 'attack'; shoot({ x: sm.x, y: sm.y, a, speed: 24, dmg: sm.dmg * (sm.plasma ? 1.8 : 1), pierce: sm.plasma ? 3 : 1, kind: sm.plasma ? 'plasma' : 'bullet', life: 0.5, tags: ['summon', 'proj'], r: 0.18, spr: sm.sk ? projSprite(sm.sk, 'bullet') : undefined }); sm.cd = cdOf(sm.sk, sm.rate); }
        else sm.cd = 0.2;
      }
    }
    else if (sm.kind === 'ace') {
      sm.a += dt * 0.9;
      sm.x = p.x + Math.cos(sm.a) * 6; sm.y = p.y + Math.sin(sm.a) * 6;
      sm.face = sm.a + Math.PI / 2;
      const ask = sm.sk;
      if (lvAt(ask, 6)) { sm.bombT -= dt; if (sm.bombT <= 0) { sm.bombT = 1.2; const x = sm.x, y = sm.y; setTimeout(() => G && explode(x, y, 2.2 * G.stats.area, skillDmg(ask, 3), ['area', 'summon']), 500); } }
      if (lvAt(ask, 7)) { sm.gzT -= dt; if (sm.gzT <= 0) { sm.gzT = 12; G.effects.push({ kind: 'expl', x: p.x, y: p.y, r: 9, t: 0, life: 0.9 }); hitArea(p.x, p.y, 16, skillDmg(ask, 60), ['area', 'summon'], { moabMult: 2 }); shake(1); play('MegaExplosion0*', { vol: 1 }) || play('Explosion0*', { vol: 1 }); } }
    } else if (sm.kind === 'beast') {
      const bsk = sm.sk, B = BEASTS[sm.sp] || BEASTS.raptor1, spd = (B.bird ? 12 : 9) * (lvAt(bsk, 5) ? 1.4 : 1);
      sm.cd -= dt;
      const t = nearestBloon(sm.x, sm.y, 14) ;
      const tx = t && Math.hypot(t.x - p.x, t.y - p.y) < 16 ? t : null;
      const gx = tx ? tx.x : p.x + 1.5, gy = tx ? tx.y : p.y + 1.5;
      const dx = gx - sm.x, dy = gy - sm.y, d = Math.hypot(dx, dy);
      if (d > (tx ? tx.r + 0.6 : 1.2)) { const m = Math.min(d, spd * dt); if (B.bird) { sm.x += dx / d * m; sm.y += dy / d * m; } else moveCircle(Object.assign(sm, { r: 0.4 }), dx / d * m, dy / d * m); sm.face = Math.atan2(dy, dx); }
      sm.dive = Math.max(0, (sm.dive || 0) - dt * 2.5);
      if (tx && d < tx.r + 1 && sm.cd <= 0) {
        sm.cd = cdOf(bsk, B.bird ? 0.6 : 0.45); sm.dive = 1;
        damage(tx, skillDmg(bsk, B.dmg * (lvAt(bsk, 6) ? 1.5 : 1)), bsk.def.tags, { moabMult: lvAt(bsk, 7) ? 3 : 1 });
        if ((lvAt(bsk, 4) && B.bird || B.stun) && !tx.isBoss) tx.stunT = Math.max(tx.stunT, 0.5);
        sm.anim = 'attack'; sm.face = Math.atan2(dy, dx);
      }
    } else if (sm.kind === 'village') {
      const dx = p.x - 2.2 - sm.x, dy = p.y + 1.6 - sm.y;
      sm.x += dx * Math.min(1, dt * 2); sm.y += dy * Math.min(1, dt * 2);
    }
  }
  G.summons = G.summons.filter(sm => sm.kind !== 'sentry' || sm.t < sm.life);

  // pickups
  const mag = s.magnet;
  for (const pk of G.pickups) {
    pk.t += dt;
    if (pk.vx) { pk.x += pk.vx * dt; pk.y += pk.vy * dt; pk.vx *= 0.9; pk.vy *= 0.9; if (Math.abs(pk.vx) < 0.05) pk.vx = 0; }
    const dx = p.x - pk.x, dy = p.y - pk.y, d = Math.hypot(dx, dy);
    const range = pk.kind === 'soul' ? mag : pk.kind === 'chest' ? 0 : pk.kind === 'relic' ? 2.2 : 1.4;
    if (d < range || pk.vac) { const k = Math.min(1, dt * (pk.vac ? 14 : 10)); pk.x += dx * k; pk.y += dy * k; }
    if (d < (pk.kind === 'chest' ? 1.4 : 0.7)) {
      pk.dead = true;
      if (pk.kind === 'soul') { gainXp(pk.v); rs('hero').xp += pk.v * G.stats.xp * G.chaos.xp; }
      else if (pk.kind === 'relic') gainRelic(pk.id);
      else if (pk.kind === 'heart') { rs('hero').heal += Math.min(s.maxhp - p.hp, s.maxhp * 0.3); p.hp = Math.min(s.maxhp, p.hp + s.maxhp * 0.3); toast('+30% health', '#ff7a8a'); }
      else if (pk.kind === 'banana') { const f = rs('farm'); f.heal += Math.min(s.maxhp - p.hp, pk.v); f.xp += pk.xp * G.stats.xp * G.chaos.xp; p.hp = Math.min(s.maxhp, p.hp + pk.v); gainXp(pk.xp); G.texts.push({ x: p.x, y: p.y - 1, s: '+' + Math.round(pk.v), t: 0, life: 0.7, heal: true }); }
      else if (pk.kind === 'chest') {
        const cost = pk.free ? 0 : chestCost();
        if (G.gold >= cost) {
          G.gold -= cost; if (!pk.free) G.chestsOpened++; G.chests++;
          G.pendingChest = (G.pendingChest || 0) + 1;
          for (const q of G.pickups) if (q.kind === 'soul') q.vac = true;
          play('UIChestOpen03', { vol: 0.9 }); play('MoneybagsOpen', { vol: 0.6 }); META.chest(pk.x, pk.y);
          if (cost) G.texts.push({ x: p.x, y: p.y - 1, s: '-$' + cost, t: 0, life: 1, gold: true });
          openLevelUp(true);
        } else {
          pk.dead = false;   // can't afford: chest stays put
          if (!pk.denyT || G.t - pk.denyT > 1.5) { pk.denyT = G.t; toast(`Need $${cost} to open (have $${Math.floor(G.gold)})`, '#ffcf5a'); play('UIChestLatch02', { vol: 0.6 }); }
        }
      }
    }
    if (pk.kind === 'chest') pk.afford = pk.free || G.gold >= chestCost();
  }
  G.pickups = G.pickups.filter(pk => !pk.dead);
  if (G.pickups.length > 900) { // merge distant souls
    const souls = G.pickups.filter(q => q.kind === 'soul');
    let acc = 0; for (const q of souls.slice(0, 300)) { acc += q.v; q.dead = true; }
    G.pickups = G.pickups.filter(q => !q.dead); dropSoul(p.x + rnd(-6, 6), p.y + rnd(-6, 6), acc);
  }

  // effects
  for (const e of G.effects) e.t += dt;
  G.effects = G.effects.filter(e => e.t < e.life);
  for (const t of G.texts) { t.t += dt; t.y -= dt * 1.4; }
  G.texts = G.texts.filter(t => t.t < t.life);
  if (G.texts.length > 120) G.texts.splice(0, G.texts.length - 120);
  G.bloons = G.bloons.filter(b => !b.dead);

  // camera
  G.cam.x = lerp(G.cam.x, p.x, Math.min(1, dt * 8)); G.cam.y = lerp(G.cam.y, p.y, Math.min(1, dt * 8));
  G.cam.shake = Math.max(0, G.cam.shake - dt * 2);
  G.toastT -= dt;
}
function shake(v) { if (!SETTINGS.shake) return; G.cam.shake = Math.min(1.2, G.cam.shake + v); }

// ---------------------------------------------------------------- render
function render(dt = 0.016) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (!G) return;
  R3.frame(G, dt);
  // floating damage numbers
  ctx.textAlign = 'center';
  const u = H / 1080;
  for (const t of G.texts) {
    const p = R3.project(t.x, t.y, 1.6 + t.t * 1.2, W, H); if (!p) continue;
    const a = 1 - t.t / t.life;
    ctx.globalAlpha = a;
    const fs = (t.crit ? 30 : t.hurt ? 30 : 21) * u;
    ctx.font = `900 ${fs}px "Trebuchet MS", sans-serif`;
    ctx.lineWidth = Math.max(2, fs * 0.16); ctx.strokeStyle = '#000'; ctx.strokeText(t.s, p[0], p[1]);
    ctx.fillStyle = t.hurt ? '#ff4d5e' : t.heal ? '#7dff8a' : t.gold ? '#ffd84a' : DMG_COL[t.kind] || (t.crit ? '#ffd23f' : '#fff');
    ctx.fillText(t.s, p[0], p[1]);
  }
  ctx.globalAlpha = 1;
  // elite / boss health bars over 3D models
  const bars = G.bloons.filter(b => b.def.moab);
  const ef = uiImg('Health_Bar_Frame_Elite'), eb = uiImg('Health_Bar_Elite_Red'), bi = uiImg('btd_BloonHealth');
  for (const b of bars) {
    const p = R3.project(b.x, b.y, b.r * 1.8 + 1, W, H); if (!p) continue;
    const bw = 130 * u, bh = bw * 48 / 234, k = Math.max(0, b.hp / b.maxhp);
    if (ef && eb) {   // frame first, then the red bar (its art spans x 57..210 of 234)
      const sc = bw / 234, x0 = p[0] - bw / 2;
      ctx.drawImage(ef, x0, p[1], bw, bh);
      ctx.drawImage(eb, 57, 0, 154 * k, 48, x0 + 57 * sc, p[1], 154 * k * sc, bh);
    } else {
      ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(p[0] - bw / 2, p[1], bw, 8 * u);
      ctx.fillStyle = '#ff3b4f'; ctx.fillRect(p[0] - bw / 2 + 1, p[1] + 1, (bw - 2) * k, 8 * u - 2);
    }
    if (bi) ctx.drawImage(bi, p[0] - bw / 2 - 16 * u, p[1] - 4 * u, 24 * u, 25 * u);
  }
  // portal labels
  if (G.portals) for (const pt of G.portals) {
    const q = R3.project(pt.x, pt.y, 3.6, W, H); if (!q) continue;
    text(pt.kind === 'continue' ? 'CONTINUE' : 'END RUN', q[0], q[1], 22 * u, pt.kind === 'continue' ? '#7fd8ff' : '#ff8a7a', 'center');
    text(pt.kind === 'continue' ? `New arena · Loop ${G.loop + 2} · stronger bloons` : 'Finish with your score', q[0], q[1] + 20 * u, 13 * u, '#e8e0d0', 'center');
    if (pt.near) text(`Press E to ${pt.kind === 'continue' ? 'enter' : 'end the run'}`, q[0], q[1] + 42 * u, 17 * u + Math.sin(G.t * 6) * u, '#ffe39a', 'center');
  }
  if (G.grace > 0 && G.state === 'play') {
    text('GET READY', W / 2, H * 0.36, 34 * u, '#ffe39a', 'center');
    text(String(Math.ceil(G.grace)), W / 2, H * 0.36 + 70 * u, 72 * u, '#fff', 'center');
  }
  // chest price tags
  for (const pk of G.pickups) {
    if (pk.kind !== 'chest') continue;
    const p = R3.project(pk.x, pk.y, 2.2, W, H); if (!p) continue;
    const cost = pk.free ? 0 : chestCost(), ok = G.gold >= cost;
    ctx.fillStyle = 'rgba(0,0,0,.6)'; roundRect(p[0] - 44 * u, p[1] - 18 * u, 88 * u, 26 * u, 8 * u); ctx.fill();
    const coin = uiImg('btd_Coin'); if (coin) ctx.drawImage(coin, p[0] - 40 * u, p[1] - 15 * u, 20 * u, 20 * u);
    text(cost ? '$' + cost : 'FREE', p[0] + 8 * u, p[1] + 2 * u, 17 * u, ok ? '#ffd84a' : '#ff8a6a', 'center');
  }
  if (!render.vig || render.vig.width !== W || render.vig.height !== H) {
    const c = render.vig = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'), vg = g.createRadialGradient(W / 2, H / 2, H * 0.4, W / 2, H / 2, H * 0.95);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.45)'); g.fillStyle = vg; g.fillRect(0, 0, W, H);
  }
  ctx.drawImage(render.vig, 0, 0);
  if (G.player.hp / G.stats.maxhp < 0.3 || G.player.hurtT > 0.01) {
    const ui = img('ui/UI_Damage_Screen');
    ctx.globalAlpha = G.player.hp / G.stats.maxhp < 0.3 ? 0.35 + Math.sin(G.t * 6) * 0.15 : clamp(G.player.hurtT * 2, 0, 0.45);
    if (ui.complete && ui.naturalWidth) ctx.drawImage(ui, 0, 0, W, H);
    ctx.globalAlpha = 1;
  }
  drawHUD();
}
function pickSpr(list) { for (const n of list) if (sprite(n)) return n; return list[0]; }
function glowDot(x, y, r, rgb) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${rgb},1)`); g.addColorStop(0.4, `rgba(${rgb},.5)`); g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
}
function drawWalls() {
  const A = G.arena, S = A.S;
  const sh = G.cam.shake * 0.4;
  const vx0 = G.cam.x - W / 2 / Z, vy0 = G.cam.y - H / 2 / Z;
  const sx = vx0 * S, sy = vy0 * S, sw = W / Z * S, shh = H / Z * S;
  ctx.drawImage(A.overlay, sx, sy, sw, shh, 0, 0, W, H);
}
function drawBloon(b, toS) {
  const [sx, sy] = toS(b.x, b.y);
  const size = b.r * 2.3 * Z;
  const bob = Math.sin(b.wob) * 0.05 * Z;
  ctx.save();
  if (b.hitT > 0) ctx.filter = 'brightness(2.2)';
  else if (b.frozenT > 0) ctx.filter = 'hue-rotate(160deg) brightness(1.4) saturate(0.6)';
  let spr = b.def.spr;
  if (b.type === 'ceramic') { const f = b.hp / b.maxhp; spr = f > 0.8 ? 'Ceramic' : 'CeramicDamage' + Math.min(4, 1 + Math.floor((0.8 - f) / 0.2)); }
  if (b.def.moab) {
    const a = Math.atan2(G.player.y - b.y, G.player.x - b.x), left = Math.cos(a) < 0;
    if (!drawSprite(ctx, spr, sx, sy + bob, size * 1.7, left ? a - Math.PI : a, left)) { ctx.fillStyle = b.def.color; ctx.beginPath(); ctx.ellipse(sx, sy, size * 0.8, size * 0.45, a, 0, TAU); ctx.fill(); }
  } else if (!drawSprite(ctx, spr, sx, sy + bob, size)) {
    ctx.fillStyle = b.def.color; ctx.beginPath(); ctx.ellipse(sx, sy + bob, size * 0.38, size * 0.45, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.4)'; ctx.beginPath(); ctx.ellipse(sx - size * 0.12, sy - size * 0.15 + bob, size * 0.08, size * 0.13, -0.4, 0, TAU); ctx.fill();
  }
  ctx.restore();
  if (b.burnT > 0) drawSprite(ctx, 'Fire00' + (1 + Math.floor((G.t * 12 + b.wob) % 4)), sx, sy - size * 0.1, size * 0.8, 0, false, 0.9);
  if (b.frozenT > 0) { ctx.fillStyle = 'rgba(170,230,255,.35)'; ctx.beginPath(); ctx.arc(sx, sy, size * 0.5, 0, TAU); ctx.fill(); }
  if (b.slowT > 0 && hasSkill('glue')) { ctx.fillStyle = 'rgba(190,255,90,.25)'; ctx.beginPath(); ctx.arc(sx, sy + size * 0.2, size * 0.35, 0, TAU); ctx.fill(); }
  if (b.elite || (b.def.moab)) {
    const w = size * 1.2, hh = Math.max(4, 0.12 * Z);
    ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(sx - w / 2, sy - size * 0.75, w, hh);
    ctx.fillStyle = '#ff3b4f'; ctx.fillRect(sx - w / 2 + 1, sy - size * 0.75 + 1, (w - 2) * Math.max(0, b.hp / b.maxhp), hh - 2);
  }
}
function drawBoss(b, toS) {
  const [sx, sy] = toS(b.x, b.y);
  const size = b.r * 2.6 * Z;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(sx, sy + b.r * Z * 0.9, b.r * Z, b.r * Z * 0.35, 0, 0, TAU); ctx.fill();
  const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, size);
  g.addColorStop(0, b.def.color + '66'); g.addColorStop(1, b.def.color + '00');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, size, 0, TAU); ctx.fill();
  if (b.hitT > 0) ctx.filter = 'brightness(1.8)';
  let name = b.def.spr.find(n => sprite(n));
  if (b.def.ds) { const f = 1 - b.hp / b.maxhp, k = Math.floor(f * (b.def.ds.length + 1)); if (k > 0) name = b.def.ds[Math.min(b.def.ds.length - 1, k - 1)]; }
  const bob = Math.sin(b.wob) * 0.1 * Z;
  let rot = 0, flip = false;
  if (b.def.moabLike) { const a = Math.atan2(G.player.y - b.y, G.player.x - b.x); flip = Math.cos(a) < 0; rot = flip ? a - Math.PI : a; }
  if (!name || !drawSprite(ctx, name, sx, sy + bob, size * (b.def.moabLike ? 1.5 : 1), rot, flip)) {
    // fallback: giant layered bloon
    drawSprite(ctx, 'ZomgIcon', sx, sy, size * 1.2, Math.atan2(G.player.y - b.y, G.player.x - b.x)) || (ctx.fillStyle = b.def.color, ctx.beginPath(), ctx.arc(sx, sy, size / 2, 0, TAU), ctx.fill());
  }
  ctx.restore();
}
function drawPlayer(toS) {
  const p = G.player;
  const [sx, sy] = toS(p.x, p.y);
  const moving = Math.hypot(p.vx, p.vy) > 0.5;
  const bob = moving ? Math.abs(Math.sin(G.t * 12)) * 0.12 * Z : Math.sin(G.t * 3) * 0.03 * Z;
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(sx, sy + 0.55 * Z, 0.6 * Z, 0.22 * Z, 0, 0, TAU); ctx.fill();
  // pickup radius hint
  ctx.strokeStyle = 'rgba(140,255,220,.08)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(sx, sy, G.stats.magnet * Z, 0, TAU); ctx.stroke();
  if (p.buffT > 0) glowDot(sx, sy, 1.4 * Z, '255,80,220');
  ctx.save();
  if (p.inv > 0 && Math.floor(G.t * 20) % 2) ctx.globalAlpha = 0.5;
  if (p.hurtT > 0) ctx.filter = 'brightness(1.5) sepia(1) hue-rotate(-40deg) saturate(4)';
  const name = pickSpr(G.ch.spr);
  if (!drawSprite(ctx, name, sx, sy - bob, 2.0 * Z, moving ? Math.sin(G.t * 12) * 0.08 : 0, p.face < 0)) {
    ctx.fillStyle = '#8b5a2b'; ctx.beginPath(); ctx.arc(sx, sy - bob, 0.6 * Z, 0, TAU); ctx.fill();
  }
  ctx.restore();
  // aim indicator
  if (G.manualAim) {
    const wx = (mouse.x - W / 2) / Z + G.cam.x, wy = (mouse.y - H / 2) / Z + G.cam.y, a = Math.atan2(wy - p.y, wx - p.x);
    ctx.strokeStyle = 'rgba(255,230,150,.6)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(sx, sy, 1.2 * Z, a - 0.25, a + 0.25); ctx.stroke();
  }
}
function drawGlaive(sx, sy, r, rot) {
  ctx.save(); ctx.translate(sx, sy); ctx.rotate(rot);
  ctx.fillStyle = '#d8e6f2'; ctx.strokeStyle = '#4a5866'; ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) { const a = i * TAU / 6; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); ctx.lineTo(Math.cos(a + 0.5) * r * 0.45, Math.sin(a + 0.5) * r * 0.45); }
  ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
}
function drawProj(pr, toS) {
  const [sx, sy] = toS(pr.x, pr.y);
  if (sx < -50 || sy < -50 || sx > W + 50 || sy > H + 50) return;
  ctx.save(); ctx.translate(sx, sy); ctx.rotate(pr.rot);
  switch (pr.kind) {
    case 'dart': case 'bolt': {
      const L = (pr.kind === 'bolt' ? 0.9 : 0.7) * Z;
      ctx.strokeStyle = pr.kind === 'bolt' ? '#ffe9a8' : '#3b2a1a'; ctx.lineWidth = Math.max(2, 0.08 * Z);
      ctx.beginPath(); ctx.moveTo(-L / 2, 0); ctx.lineTo(L / 2, 0); ctx.stroke();
      ctx.fillStyle = '#c9ced4'; ctx.beginPath(); ctx.moveTo(L / 2 + 0.18 * Z, 0); ctx.lineTo(L / 2 - 0.05 * Z, -0.1 * Z); ctx.lineTo(L / 2 - 0.05 * Z, 0.1 * Z); ctx.fill();
      ctx.fillStyle = '#e44'; ctx.fillRect(-L / 2, -0.1 * Z, 0.18 * Z, 0.2 * Z);
      break; }
    case 'tack': ctx.fillStyle = '#d9dde3'; ctx.beginPath(); ctx.moveTo(0.3 * Z, 0); ctx.lineTo(-0.15 * Z, -0.09 * Z); ctx.lineTo(-0.15 * Z, 0.09 * Z); ctx.fill(); ctx.fillStyle = '#777'; ctx.fillRect(-0.2 * Z, -0.12 * Z, 0.08 * Z, 0.24 * Z); break;
    case 'glaive': ctx.restore(); drawGlaive(sx, sy, pr.r * Z * 1.3, pr.rot); return;
    case 'shuriken': ctx.fillStyle = '#c0c6d0'; ctx.strokeStyle = '#333'; ctx.lineWidth = 1.5; ctx.beginPath(); for (let i = 0; i < 4; i++) { const a = i * TAU / 4; ctx.lineTo(Math.cos(a) * 0.32 * Z, Math.sin(a) * 0.32 * Z); ctx.lineTo(Math.cos(a + 0.78) * 0.09 * Z, Math.sin(a + 0.78) * 0.09 * Z); } ctx.closePath(); ctx.fill(); ctx.stroke(); break;
    case 'bomb': ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(0, 0, 0.32 * Z, 0, TAU); ctx.fill(); ctx.fillStyle = '#ff9a2a'; ctx.beginPath(); ctx.arc(-0.3 * Z, 0, 0.1 * Z + Math.random() * 3, 0, TAU); ctx.fill(); break;
    case 'torpedo': ctx.fillStyle = '#9fb3c8'; ctx.beginPath(); ctx.ellipse(0, 0, 0.42 * Z, 0.13 * Z, 0, 0, TAU); ctx.fill(); ctx.restore(); glowDot(sx - Math.cos(pr.rot) * 0.5 * Z, sy - Math.sin(pr.rot) * 0.5 * Z, 0.3 * Z, '127,227,255'); return;
    case 'plasma': ctx.restore(); glowDot(sx, sy, 0.45 * Z, '120,180,255'); ctx.fillStyle = '#eaf3ff'; ctx.beginPath(); ctx.arc(sx, sy, 0.12 * Z, 0, TAU); ctx.fill(); return;
    case 'sun': ctx.restore(); glowDot(sx, sy, 0.6 * Z, '255,220,90'); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(sx, sy, 0.16 * Z, 0, TAU); ctx.fill(); return;
    case 'bullet': ctx.fillStyle = '#ffe28a'; ctx.fillRect(-0.18 * Z, -0.04 * Z, 0.36 * Z, 0.08 * Z); break;
  }
  ctx.restore();
}
function drawHazard(h, toS) {
  const [sx, sy] = toS(h.x, h.y);
  const r = h.r * Z;
  if (h.kind === 'glue') {
    ctx.globalAlpha = Math.min(1, (h.life - h.t) * 2) * 0.6;
    ctx.fillStyle = '#a8e63c'; ctx.beginPath(); ctx.ellipse(sx, sy, r, r * 0.8, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#d6ff7a'; ctx.beginPath(); ctx.ellipse(sx - r * 0.3, sy - r * 0.2, r * 0.25, r * 0.15, 0, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  } else if (h.kind === 'spikes') {
    ctx.fillStyle = '#9aa3ad'; ctx.strokeStyle = '#3c434a'; ctx.lineWidth = 1;
    for (let i = 0; i < 7; i++) { const a = i * 2.4 + h.x, d = (i % 3) * 0.3 * r; const px = sx + Math.cos(a) * d, py = sy + Math.sin(a) * d; ctx.beginPath(); ctx.moveTo(px, py - 0.25 * Z); ctx.lineTo(px - 0.12 * Z, py + 0.1 * Z); ctx.lineTo(px + 0.12 * Z, py + 0.1 * Z); ctx.closePath(); ctx.fill(); ctx.stroke(); }
  } else if (h.kind === 'bossSlam' || h.kind === 'delayed') {
    const k = h.t / h.life;
    ctx.strokeStyle = h.kind === 'bossSlam' ? 'rgba(255,40,40,.9)' : 'rgba(255,190,60,.8)'; ctx.lineWidth = 3;
    ctx.fillStyle = h.kind === 'bossSlam' ? 'rgba(255,30,30,.18)' : 'rgba(255,170,40,.12)';
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = h.kind === 'bossSlam' ? 'rgba(255,40,40,.35)' : 'rgba(255,190,60,.3)';
    ctx.beginPath(); ctx.arc(sx, sy, r * k, 0, TAU); ctx.fill();
  } else if (h.kind === 'chargeLine') {
    ctx.save(); ctx.translate(sx, sy); ctx.rotate(h.a);
    ctx.fillStyle = `rgba(255,40,40,${0.15 + 0.25 * h.t / h.life})`; ctx.fillRect(0, -h.w * Z / 2, h.len * Z, h.w * Z);
    ctx.strokeStyle = 'rgba(255,60,60,.8)'; ctx.lineWidth = 2; ctx.strokeRect(0, -h.w * Z / 2, h.len * Z, h.w * Z); ctx.restore();
  }
}
function drawEffect(e, toS) {
  const [sx, sy] = toS(e.x, e.y), k = e.t / e.life;
  switch (e.kind) {
    case 'pop':
      if (!drawSprite(ctx, 'PopIcon', sx, sy, e.r * 2.2 * Z * (0.8 + k * 0.4), 0, false, 1 - k)) {
        ctx.strokeStyle = `rgba(255,255,255,${1 - k})`; ctx.lineWidth = 3;
        for (let i = 0; i < 8; i++) { const a = i * TAU / 8; ctx.beginPath(); ctx.moveTo(sx + Math.cos(a) * e.r * Z * 0.5, sy + Math.sin(a) * e.r * Z * 0.5); ctx.lineTo(sx + Math.cos(a) * e.r * Z * (0.8 + k), sy + Math.sin(a) * e.r * Z * (0.8 + k)); ctx.stroke(); }
      }
      break;
    case 'boom': {
      const vfx = img('ui/VFX_Impact_4_Texture_1');
      ctx.globalAlpha = 1 - k;
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, e.r * Z);
      g.addColorStop(0, '#fff'); g.addColorStop(0.3, e.color); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, e.r * Z * (0.6 + k * 0.5), 0, TAU); ctx.fill();
      if (vfx.complete && vfx.naturalWidth) { ctx.globalCompositeOperation = 'lighter'; const s = e.r * Z * 2.4 * (0.7 + k * 0.5); ctx.drawImage(vfx, sx - s / 2, sy - s / 2, s, s); ctx.globalCompositeOperation = 'source-over'; }
      ctx.globalAlpha = 1; break; }
    case 'ring':
      ctx.strokeStyle = e.color; ctx.globalAlpha = 1 - k; ctx.lineWidth = 0.25 * Z * (1 - k);
      ctx.beginPath(); ctx.arc(sx, sy, e.r * Z * k, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1; break;
    case 'frost': {
      const r = e.r * Z * (0.3 + 0.7 * k);
      const g = ctx.createRadialGradient(sx, sy, r * 0.6, sx, sy, r);
      g.addColorStop(0, 'rgba(160,220,255,0)'); g.addColorStop(0.85, `rgba(190,235,255,${0.45 * (1 - k)})`); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.fill(); break; }
    case 'flame': {
      const d = e.sp * e.t, x = sx + Math.cos(e.a) * d * Z, y = sy + Math.sin(e.a) * d * Z, r = (0.25 + k * 0.9) * Z * e.s;
      ctx.globalCompositeOperation = 'lighter';
      glowDot(x, y, r, k < 0.4 ? '255,200,80' : '255,90,30');
      ctx.globalCompositeOperation = 'source-over'; break; }
    case 'bolt': {
      const [x2, y2] = toS(e.x2, e.y2);
      ctx.strokeStyle = `rgba(200,230,255,${1 - k})`; ctx.lineWidth = 3; ctx.shadowColor = '#7cf'; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.moveTo(sx, sy);
      const n = 6; for (let i = 1; i < n; i++) { const t = i / n; ctx.lineTo(lerp(sx, x2, t) + rnd(-0.35, 0.35) * Z, lerp(sy, y2, t) + rnd(-0.35, 0.35) * Z); }
      ctx.lineTo(x2, y2); ctx.stroke(); ctx.shadowBlur = 0; break; }
    case 'line': {
      const [x2, y2] = toS(e.x2, e.y2);
      ctx.strokeStyle = e.color; ctx.globalAlpha = 1 - k; ctx.lineWidth = e.w * Z;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(x2, y2); ctx.stroke(); ctx.globalAlpha = 1; break; }
    case 'target':
      ctx.strokeStyle = `rgba(255,190,60,${0.4 + k * 0.5})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(sx, sy, e.r * Z, 0, TAU); ctx.stroke(); break;
    case 'ghost':
      ctx.globalAlpha = 0.35 * (1 - k); drawSprite(ctx, pickSpr(G.ch.spr), sx, sy, 1.7 * Z, 0, e.face < 0); ctx.globalAlpha = 1; break;
  }
}

// ---------------------------------------------------------------- HUD
function uiImg(n) { const i = img('ui/' + n); return i.complete && i.naturalWidth ? i : null; }
function drawHUD() {
  const p = G.player, s = G.stats, u = H / 1080; // ui scale
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // Phayze blind: darkness closing in around the hero
  if (G.blindT > 0) {
    const q = R3.project(p.x, p.y, 1, W, H) || [W / 2, H / 2], k = Math.min(1, G.blindT / 0.6, (G.blindMax - G.blindT + 0.01) / 0.5);
    const r0 = H * 0.09, r1 = H * (0.2 + 0.25 * (1 - k));
    const g = ctx.createRadialGradient(q[0], q[1], r0, q[0], q[1], r1);
    g.addColorStop(0, 'rgba(0,4,12,0)'); g.addColorStop(1, `rgba(0,4,12,${0.97 * k})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  ctx.textAlign = 'left';
  // XP bar top
  const xw = Math.min(W * 0.6, 900 * u), xh = 30 * u, xx = (W - xw) / 2, xy = 14 * u;
  const xf = uiImg('XP_Frame_Bar'), xb = uiImg('XP_Bar');
  ctx.fillStyle = 'rgba(0,0,0,.6)'; roundRect(xx, xy, xw, xh, 8 * u); ctx.fill();
  const xpk = clamp(G.xp / G.xpNext, 0, 1);
  if (xf) slice3(xf, xx, xy, xw, xh);
  if (xb) { if (xpk > 0.01) slice3(xb, xx + 3 * u, xy + 3 * u, Math.max(xh, (xw - 6 * u) * xpk), xh - 6 * u); }
  else { const g = ctx.createLinearGradient(xx, 0, xx + xw, 0); g.addColorStop(0, '#3fd0ff'); g.addColorStop(1, '#b46bff'); ctx.fillStyle = g; ctx.fillRect(xx + 4 * u, xy + 4 * u, (xw - 8 * u) * xpk, xh - 8 * u); }
  if (!xf) { ctx.strokeStyle = '#c99a4a'; ctx.lineWidth = 2; roundRect(xx, xy, xw, xh, 8 * u); ctx.stroke(); }
  const xi = uiImg('btd_PlayerXPIcon'); if (xi) ctx.drawImage(xi, xx - 26 * u, xy - 9 * u, 48 * u, 48 * u);
  text(`LV ${G.level}`, xx + xw / 2, xy + xh * 0.72, 18 * u, '#fff', 'center');
  // timer & progress (objective)
  text(fmtTime(G.t), W / 2, xy + xh + 34 * u, 28 * u, '#ffe9b0', 'center');
  const B = G.boss;
  if (!(B && !B.dead)) {
    const of = uiImg('Objective_Frame');
    const ow = 420 * u, oh = 38 * u, ox = (W - ow) / 2, oy = xy + xh + 44 * u;
    if (of) ctx.drawImage(of, ox - 10 * u, oy - 4 * u, ow + 20 * u, oh + 8 * u); else { ctx.fillStyle = 'rgba(0,0,0,.55)'; roundRect(ox, oy, ow, oh, 6 * u); ctx.fill(); }
    const prog = clamp((G.pops - G.goalStart) / (G.goal - G.goalStart), 0, 1);
    ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(ox + 40 * u, oy + oh * 0.62, ow - 80 * u, 6 * u);
    ctx.fillStyle = '#ff5d6c'; ctx.fillRect(ox + 40 * u, oy + oh * 0.62, (ow - 80 * u) * prog, 6 * u);
    for (let i = 1; i < 4; i++) { ctx.fillStyle = '#ffd36b'; ctx.fillRect(ox + 40 * u + (ow - 80 * u) * i / 5 - 1, oy + oh * 0.55, 2, 10 * u); }
    text(`${G.loop ? 'Loop ' + (G.loop + 1) + ' · ' : ''}Pop bloons to summon the boss  ${G.pops - G.goalStart}/${G.goal - G.goalStart}`, W / 2, oy + oh * 0.48, 14 * u, '#f3e9d6', 'center');
  }

  // ---- bottom center: Soulstone health bar sitting right above the skill bar
  const n = G.skills.length, ss = 70 * u, gap = 10 * u, rowW = n * ss + (n - 1) * gap, sx0 = (W - rowW) / 2, sy0 = H - ss - 22 * u;
  const hw = Math.max(520 * u, rowW + 120 * u), hh = hw * 127 / 1024, hx = (W - hw) / 2, hy = sy0 - hh - 6 * u;
  const hf = uiImg('Health_Frame');
  const hk = clamp(p.hp / s.maxhp, 0, 1);
  // Soulstone frame first, then the bar inside its dark channel (x 5%..95%, y 37%..63%)
  if (hf) ctx.drawImage(hf, hx, hy, hw, hh);
  const ix = hx + hw * 0.05, iw = hw * 0.9, iy = hy + hh * 0.38, ih = hh * 0.25;
  ctx.fillStyle = 'rgba(40,0,0,.85)'; ctx.fillRect(ix, iy, iw, ih);
  p.shownHp = p.shownHp === undefined ? hk : Math.max(hk, p.shownHp - 0.006);
  if (p.shownHp > hk) { ctx.fillStyle = '#ffe9b0'; ctx.fillRect(ix, iy, iw * p.shownHp, ih); }
  const g = ctx.createLinearGradient(0, iy, 0, iy + ih);
  if (hk > 0.3) { g.addColorStop(0, '#9dff7a'); g.addColorStop(0.5, '#3ac33a'); g.addColorStop(1, '#1d7a1d'); } else { g.addColorStop(0, '#ff8a7a'); g.addColorStop(0.5, '#e02d2d'); g.addColorStop(1, '#7a0f0f'); }
  ctx.fillStyle = g; ctx.fillRect(ix, iy, iw * hk, ih);
  text(`${Math.ceil(p.hp)} / ${Math.round(s.maxhp)}`, W / 2, iy + ih * 0.82, 15 * u, '#fff', 'center');
  // hero portrait left of the bar, dash right of it
  const pr = 84 * u;
  const hsk = selectedSkin(G.ch), hic = uiImg('heroes/' + (hsk ? hsk.icon : HERO_ICON[G.ch.id]));
  if (hic) ctx.drawImage(hic, hx - pr * 0.95, hy + hh * 0.5 - pr / 2, pr, pr); else drawSprite(ctx, pickSpr(G.ch.spr), hx - pr * 0.45, hy + hh * 0.5, pr);
  const di = uiImg('Dash_Icon'), ds = 54 * u, dx = hx + hw + 6 * u, dy = hy + hh / 2 - ds / 2;
  ctx.save(); if (p.dashN < 1) ctx.globalAlpha = 0.45;
  if (di) ctx.drawImage(di, dx, dy, ds, ds); else { ctx.fillStyle = '#5ad'; ctx.beginPath(); ctx.arc(dx + ds / 2, dy + ds / 2, ds / 2, 0, TAU); ctx.fill(); }
  ctx.restore();
  if (G.stats.dashes > 1) text('x' + p.dashN, dx + ds - 2 * u, dy + 14 * u, 15 * u, '#9fe8ff', 'right');
  if (p.dashN < 1 && p.dashCd > 0) { ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.beginPath(); ctx.moveTo(dx + ds / 2, dy + ds / 2); ctx.arc(dx + ds / 2, dy + ds / 2, ds / 2, -Math.PI / 2, -Math.PI / 2 + TAU * p.dashCd / 2.2); ctx.fill(); }
  text('SPACE', dx + ds / 2, dy + ds + 12 * u, 11 * u, '#ccc', 'center');
  // hero ability (R), right of the dash
  const HA = HERO_ABIL[G.ch.id];
  if (HA) {
    const ai = uiImg('abil/' + HA.icon), as = 58 * u, ax = dx + ds + 12 * u, ay = hy + hh / 2 - as / 2, ready = G.abilCd <= 0;
    ctx.save(); if (!ready) ctx.globalAlpha = 0.5; if (ai) ctx.drawImage(ai, ax, ay, as, as); ctx.restore();
    if (!ready) { const k2 = clamp(G.abilCd / HA.cd, 0, 1); ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.beginPath(); ctx.moveTo(ax + as / 2, ay + as / 2); ctx.arc(ax + as / 2, ay + as / 2, as / 2, -Math.PI / 2, -Math.PI / 2 + TAU * k2); ctx.fill(); text(String(Math.ceil(G.abilCd)), ax + as / 2, ay + as / 2 + 7 * u, 20 * u, '#fff', 'center'); }
    else { ctx.strokeStyle = 'rgba(127,216,255,' + (0.5 + 0.5 * Math.sin(G.t * 5)) + ')'; ctx.lineWidth = 3 * u; ctx.beginPath(); ctx.arc(ax + as / 2, ay + as / 2, as / 2 + 2 * u, 0, TAU); ctx.stroke(); }
    text('R', ax + as / 2, ay + as + 12 * u, 11 * u, '#ccc', 'center');
  }
  // boss debuffs
  const deb = [G.drainT > 0 && `DRAINED ${Math.ceil(G.drainT)}s`, G.towerStunT > 0 && `TOWERS STUNNED ${Math.ceil(G.towerStunT)}s`, G.buf.dmg > 0 && `ROAR ${Math.ceil(G.buf.dmg)}s`, G.buf.as > 0 && `HASTE ${Math.ceil(G.buf.as)}s`, G.buf.heroDmg > 0 && `AP SHELLS ${Math.ceil(G.buf.heroDmg)}s`].filter(Boolean);
  deb.forEach((t, i) => text(t, hx + hw / 2, hy - 46 * u - i * 20 * u, 15 * u, /DRAIN|STUN/.test(t) ? '#c070ff' : '#7fd8ff', 'center'));
  // gold (pops = cash)
  const coin = uiImg('btd_Coin'), cs = 34 * u, gx = hx + hw * 0.06, gy = hy - cs + 4 * u;
  if (coin) ctx.drawImage(coin, gx, gy, cs, cs);
  text(`$${Math.floor(G.gold).toLocaleString()}`, gx + cs + 6 * u, gy + cs * 0.72, 22 * u, '#ffd84a');
  const chestI = uiImg('btd_DailyChestClosed'), cw2 = 36 * u, cx2 = hx + hw * 0.94 - cw2;
  if (chestI) ctx.drawImage(chestI, cx2, gy, cw2, cw2 * chestI.naturalHeight / chestI.naturalWidth);
  const cc = chestCost();
  text(`$${cc}`, cx2 - 6 * u, gy + cs * 0.72, 16 * u, G.gold >= cc ? '#ffd84a' : '#b49a6a', 'right');

  // skills (bottom center)
  const fr = uiImg('Item_Frame_lvl');
  G.skills.forEach((sk, i) => {
    const x = sx0 + i * (ss + gap);
    if (fr) ctx.drawImage(fr, x - 4 * u, sy0 - 4 * u, ss + 8 * u, ss + 8 * u); else { ctx.fillStyle = 'rgba(10,6,16,.8)'; roundRect(x, sy0, ss, ss, 10 * u); ctx.fill(); }
    drawSprite(ctx, pickSpr(sk.def.icon), x + ss / 2, sy0 + ss / 2, ss * 0.82);
    const base = sk.def.cd;
    if (sk.cd > 0 && base > 0.5 && sk.cd < 1e8) {
      const k2 = clamp(sk.cd / cdOf(sk, base), 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.beginPath(); ctx.moveTo(x + ss / 2, sy0 + ss / 2); ctx.arc(x + ss / 2, sy0 + ss / 2, ss * 0.48, -Math.PI / 2, -Math.PI / 2 + TAU * k2); ctx.fill();
    }
    const nl = sk.hero ? 5 : MAXLV, cur = sk.hero ? G.stats.heroExtra : sk.lv;
    if (sk.paragon) { ctx.strokeStyle = '#ffe680'; ctx.lineWidth = 3 * u; roundRect(x - 2 * u, sy0 - 2 * u, ss + 4 * u, ss + 4 * u, 12 * u); ctx.stroke(); text('★', x + ss - 8 * u, sy0 + 16 * u, 16 * u, '#ffe680', 'center'); }
    for (let l = 0; l < nl; l++) { ctx.fillStyle = l < cur ? (sk.hero ? '#7fd8ff' : '#ffd36b') : 'rgba(255,255,255,.2)'; ctx.fillRect(x + 6 * u + l * (ss - 12 * u) / nl, sy0 + ss + 4 * u, (ss - 12 * u) / nl - 2 * u, 5 * u); }
  });

  // ---- bottom-left: relics, then collected items (small icons + count)
  const items = Object.values(G.items);
  { const is0 = 34 * u, ig0 = 6 * u, rows0 = Math.ceil(items.length / 6); drawRelics(u, items.length ? H - 18 * u - rows0 * (is0 + ig0) - 18 * u : H - 18 * u); }
  drawCombo(u); drawCbLabels(u); drawTouch(u);
  if (items.length) {
    const is = 34 * u, ig = 6 * u, per = 6, x0 = 18 * u, rows = Math.ceil(items.length / per), y0 = H - 18 * u - rows * (is + ig);
    text('ITEMS', x0, y0 - 8 * u, 12 * u, '#cbbfa8');
    items.forEach((it, i) => {
      const x = x0 + (i % per) * (is + ig), y = y0 + Math.floor(i / per) * (is + ig);
      ctx.fillStyle = 'rgba(10,6,16,.75)'; roundRect(x, y, is, is, 6 * u); ctx.fill();
      ctx.strokeStyle = ['#9a9a9a', '#5fd35f', '#4aa3ff', '#c35cff', '#ffb02e'][it.rar || 0]; ctx.lineWidth = 2 * u; roundRect(x, y, is, is, 6 * u); ctx.stroke();
      const sp = (it.icon || []).find(nm => sprite(nm));
      if (sp) drawSprite(ctx, sp, x + is / 2, y + is / 2, is * 0.86);
      else text(it.name[0], x + is / 2, y + is * 0.68, 16 * u, '#ffe39a', 'center');
      if (it.n > 1) text('x' + it.n, x + is - 2 * u, y + is - 3 * u, 11 * u, '#fff', 'right');
    });
  }

  // top-left info
  text(`${G.arena.def.name}`, 22 * u, 34 * u, 18 * u, '#ffe39a');
  text(`Chaos ${G.chaos.n}  ·  Popped ${G.kills}`, 22 * u, 58 * u, 14 * u, '#cbbfa8');
  text(G.manualAim ? 'Aim: MOUSE (Q)' : 'Aim: AUTO (Q)', 22 * u, 80 * u, 13 * u, '#9b8f7a');
  const fps = R3.stats();
  text(`${fps.fps} FPS · ${fps.quality} · ${Math.round(fps.scale * 100)}% res`, 22 * u, 100 * u, 13 * u, fps.fps < 40 ? '#ff8a6a' : '#7fdc8a');
  drawMinimap(u);
  if (B && !B.dead) drawBossBar(B, u);
  // toast
  if (G.toastT > 0 && G.toast) {
    ctx.globalAlpha = clamp(G.toastT, 0, 1);
    text(G.toast.s, W / 2, H * 0.24, 30 * u, G.toast.c || '#ffe39a', 'center');
    ctx.globalAlpha = 1;
  }
}
// BTD6-style boss health bar: portrait medallion, boss-themed tiled fill, skull tier pips
const BOSS_TILE = { lych: 'btd_LychHealthBarTile', phayze: 'btd_PhayzeHealthBarTile', dreadbloon: 'btd_DreadbloonHealthbarLarge' };
const BOSS_PORTRAIT = { bloonarius: 'btd_BloonariusPortrait', lych: 'btd_LychPortrait', vortex: 'btd_VortexPortrait', dreadbloon: 'btd_DreadbloonPortrait', phayze: 'btd_PhayzePortrait', blastapopoulos: 'btd_BlastapopoulosPortrait' };
function drawBossBar(B, u) {
  const bw = Math.min(W * 0.5, 820 * u), bh = 34 * u, bx = (W - bw) / 2 + 40 * u, by = 92 * u;
  const k = clamp(B.hp / B.maxhp, 0, 1);
  B.shownHp = B.shownHp === undefined ? k : Math.max(k, B.shownHp - 0.004);
  // frame
  ctx.fillStyle = 'rgba(12,8,6,.85)'; roundRect(bx - 6 * u, by - 6 * u, bw + 12 * u, bh + 12 * u, 10 * u); ctx.fill();
  ctx.strokeStyle = '#e8c27a'; ctx.lineWidth = 3 * u; roundRect(bx - 6 * u, by - 6 * u, bw + 12 * u, bh + 12 * u, 10 * u); ctx.stroke();
  ctx.save(); roundRect(bx, by, bw, bh, 6 * u); ctx.clip();
  ctx.fillStyle = '#1a0f0c'; ctx.fillRect(bx, by, bw, bh);
  // delayed damage trail
  ctx.fillStyle = '#fff3c4'; ctx.fillRect(bx, by, bw * B.shownHp, bh);
  const tile = BOSS_TILE[B.def.id] ? uiImg(BOSS_TILE[B.def.id]) : null;
  const fw = bw * k;
  if (tile) {
    const th = bh, tw = tile.naturalWidth * th / tile.naturalHeight;
    for (let x = 0; x < fw; x += tw) ctx.drawImage(tile, 0, 0, Math.min(tile.naturalWidth, (fw - x) / tw * tile.naturalWidth), tile.naturalHeight, bx + x, by, Math.min(tw, fw - x), th);
  } else {
    const g = ctx.createLinearGradient(0, by, 0, by + bh);
    const c = B.def.color; g.addColorStop(0, '#ffffff'); g.addColorStop(0.12, c); g.addColorStop(0.75, c); g.addColorStop(1, '#000000');
    ctx.fillStyle = g; ctx.fillRect(bx, by, fw, bh);
    ctx.globalAlpha = 0.25; ctx.fillStyle = '#000';
    for (let x = bx - bh; x < bx + fw; x += bh * 0.9) { ctx.beginPath(); ctx.moveTo(x, by + bh); ctx.lineTo(x + bh * 0.45, by + bh); ctx.lineTo(x + bh * 0.95, by); ctx.lineTo(x + bh * 0.5, by); ctx.fill(); }
    ctx.globalAlpha = 1;
  }
  const grad = uiImg('btd_BossBarGradient');
  if (grad) { ctx.globalAlpha = 0.35; ctx.drawImage(grad, bx, by, fw, bh); ctx.globalAlpha = 1; }
  if (B.hitT > 0) { ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(bx, by, fw, bh); }
  ctx.restore();
  // skull tier pips at 75/50/25%
  const on = uiImg('btd_BossSkullPipOn'), off = uiImg('btd_BossSkullPipOff'), ps = 30 * u;
  const fire = uiImg('btd_BossSkullPipFire');
  [0.75, 0.5, 0.25].forEach((t, i) => {
    const im = k > t ? on : off, x = bx + bw * t - ps / 2, y = by + bh - ps * 0.35;
    if (im) ctx.drawImage(im, x, y, ps, ps);
    if (fire && i === B.blimpSkull && k > t) ctx.drawImage(fire, x + ps * 0.34, y - ps * 0.55, ps * 0.32, ps * 0.6);
  });
  // portrait medallion
  const pm = uiImg(BOSS_PORTRAIT[B.def.id]), ms = 112 * u, mx = bx - ms * 0.78, my = by + bh / 2 - ms / 2;
  ctx.fillStyle = 'rgba(12,8,6,.9)'; ctx.beginPath(); ctx.arc(mx + ms / 2, my + ms / 2, ms * 0.46, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#e8c27a'; ctx.lineWidth = 4 * u; ctx.stroke();
  if (pm) { const a = pm.naturalWidth / pm.naturalHeight; ctx.drawImage(pm, mx + ms * 0.06, my + ms * 0.1, ms * 0.88, ms * 0.88 / a); }
  const sk = uiImg('btd_BossSkullLarge');
  if (sk && B.phase === 2) ctx.drawImage(sk, bx + bw + 8 * u, by + bh / 2 - 22 * u, 50 * u, 44 * u);
  text(`${B.def.name}${B.phase === 2 ? '  — ENRAGED' : ''}`, bx + 8 * u, by - 14 * u, 22 * u, '#fff');
  text(`${Math.ceil(B.hp).toLocaleString()}`, bx + bw - 8 * u, by + bh * 0.7, 16 * u, '#fff', 'right');
  if (G.bossIntro > 0) {
    const t = 1 - Math.abs(G.bossIntro - 1.5) / 1.5;
    ctx.globalAlpha = clamp(t * 2, 0, 1);
    const tf = uiImg('BossTitle_Frame'); const tw = 900 * u, th = tw * 368 / 1024;
    if (tf) ctx.drawImage(tf, (W - tw) / 2, H * 0.32 - th / 2, tw, th);
    text(B.def.name, W / 2, H * 0.32 + 8 * u, 64 * u, '#fff', 'center');
    text(B.def.title, W / 2, H * 0.32 + 52 * u, 24 * u, '#ffb0b0', 'center');
    ctx.globalAlpha = 1;
  }
}
let miniCanvas = null, miniFor = null;
function drawMinimap(u) {
  const A = G.arena;
  if (miniFor !== A) {
    miniFor = A; miniCanvas = document.createElement('canvas'); miniCanvas.width = A.cols; miniCanvas.height = A.rows;
    const g = miniCanvas.getContext('2d'); g.drawImage(A.mask, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = 'rgba(230,210,170,.55)'; g.fillRect(0, 0, A.cols, A.rows);
  }
  const mw = 210 * u, mh = mw * A.rows / A.cols, mx = W - mw - 20 * u, my = 20 * u;
  ctx.fillStyle = 'rgba(0,0,0,.55)'; roundRect(mx - 6 * u, my - 6 * u, mw + 12 * u, mh + 12 * u, 8 * u); ctx.fill();
  ctx.drawImage(miniCanvas, mx, my, mw, mh);
  const k = mw / A.w;
  ctx.fillStyle = 'rgba(255,70,70,.8)';
  for (let i = 0; i < G.bloons.length; i += 3) { const b = G.bloons[i]; ctx.fillRect(mx + b.x * k - 1, my + b.y * k - 1, b.def.moab ? 4 : 2, b.def.moab ? 4 : 2); }
  if (G.boss && !G.boss.dead) { ctx.fillStyle = '#ff2'; ctx.beginPath(); ctx.arc(mx + G.boss.x * k, my + G.boss.y * k, 5 * u, 0, TAU); ctx.fill(); }
  for (const pk of G.pickups) if (pk.kind === 'chest') { ctx.fillStyle = '#ffcf5a'; ctx.fillRect(mx + pk.x * k - 3, my + pk.y * k - 3, 6, 6); }
  ctx.fillStyle = '#5ff'; ctx.beginPath(); ctx.arc(mx + G.player.x * k, my + G.player.y * k, 4 * u, 0, TAU); ctx.fill();
  // view rect
  ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(mx + G.player.x * k, my + G.player.y * k, 18 * k, 0, TAU); ctx.stroke();
}
function slice3(im, x, y, w, h, cap = 0.18) {
  const cw = Math.min(w / 2, h * (im.naturalWidth * cap) / im.naturalHeight), sw = im.naturalWidth * cap;
  ctx.drawImage(im, 0, 0, sw, im.naturalHeight, x, y, cw, h);
  ctx.drawImage(im, sw, 0, im.naturalWidth - 2 * sw, im.naturalHeight, x + cw, y, w - 2 * cw, h);
  ctx.drawImage(im, im.naturalWidth - sw, 0, sw, im.naturalHeight, x + w - cw, y, cw, h);
}
function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); }
function text(s, x, y, size, color, align = 'left') {
  ctx.font = `800 ${size}px "Trebuchet MS", sans-serif`; ctx.textAlign = align;
  ctx.lineWidth = Math.max(2, size * 0.18); ctx.strokeStyle = 'rgba(0,0,0,.85)'; ctx.strokeText(s, x, y);
  ctx.fillStyle = color; ctx.fillText(s, x, y);
}
function toast(s, c) { if (!G) return; G.toast = { s, c }; G.toastT = 2.5; }

// ---------------------------------------------------------------- level up (Soulstone-style card choice)
const $ = id => document.getElementById(id);
function show(id, on) { $(id).classList.toggle('hidden', !on); }
let banishMode = false, currentOffer = [];
function rollRarity(minR = 0, tower = false) {
  const W = rarityWeights(tower);
  const tot = W.reduce((a, w, i) => a + (i >= minR ? w : 0), 0);
  let x = Math.random() * tot;
  for (let i = minR; i < RARITY.length; i++) { x -= W[i]; if (x <= 0) return i; }
  return RARITY.length - 1;
}
// each card lists the lowest rarity it can appear at; the rarity is rolled first, then a card of that rarity is picked
function buildOffer(chest = false) {
  const pool = [];
  // tower cards (new towers and tower upgrades) only come from chests; level-ups give attribute cards
  if (chest) {
    for (const sk of G.skills) if (!sk.hero && sk.lv < MAXLV && !G.banished.has('up_' + sk.id)) pool.push({ type: 'up', sk, cat: 'up', minR: 0 });
    for (const sk of G.skills) if (paragonReady(sk)) pool.push({ type: 'paragon', sk, cat: 'up', minR: 0, forceR: 4 });
    if (G.skills.filter(k => !k.hero).length < 6) for (const id in SKILLS) if (!hasSkill(id) && !G.banished.has('new_' + id)) pool.push({ type: 'new', id, cat: 'new', minR: 0 });
  }
  const ownedTags = new Set(G.skills.flatMap(s => s.def.tags));
  for (const c of STAT_CARDS) {
    if (chest && pool.length) break;   // chests fall back to attributes only once every tower is maxed
    if (G.banished.has('stat_' + c.id)) continue;
    if (c.id === 'dash' && G.stats.dashes >= 3) continue;
    if (c.heroExtra && (G.stats.heroExtra >= 5 || (c.id === 'herostrike') !== heroMelee())) continue;
    if (c.tag && !ownedTags.has(c.tag)) continue;
    pool.push({ type: 'stat', c, cat: 'stat', minR: c.minR || 0 });
  }
  const CATW = { up: 4.5, new: G.skills.length < 3 ? 3 : 1.8, stat: 3.5 };
  const n = chest ? 3 : (G.level % 5 === 0 ? 4 : 3);
  const opts = [];
  for (let tries = 0; opts.length < n && pool.length && tries < 60; tries++) {
    let rar = rollRarity(0, chest);
    // a card only shows at its own minimum rarity or above; legendary-only cards (Extra Dash) need a legendary roll
    let cand = pool.filter(o => o.minR <= rar);
    while (!cand.length && rar < RARITY.length - 1) { rar++; cand = pool.filter(o => o.minR <= rar); }
    if (!cand.length) break;
    // choose a category (so 25 towers don't drown out upgrades), then a uniform card inside it
    const cats = [...new Set(cand.map(o => o.cat))], tw = cats.reduce((a, c) => a + CATW[c], 0);
    let x = Math.random() * tw, cat = cats[0];
    for (const c of cats) { x -= CATW[c]; if (x <= 0) { cat = c; break; } }
    const inCat = cand.filter(o => o.cat === cat), o = inCat.find(x => x.type === 'paragon') || inCat[Math.floor(Math.random() * inCat.length)];
    pool.splice(pool.indexOf(o), 1);
    o.rar = o.forceR ?? rar;
    opts.push(o);
  }
  // 15% of level-ups also deal a BONUS card: a tower card, normally only found in chests
  if (!chest && Math.random() < 0.15) {
    const tw = [];
    for (const sk of G.skills) if (!sk.hero && sk.lv < MAXLV && !G.banished.has('up_' + sk.id)) tw.push({ type: 'up', sk, cat: 'up', minR: 0 });
    if (G.skills.filter(k => !k.hero).length < 6) for (const id in SKILLS) if (!hasSkill(id) && !G.banished.has('new_' + id)) tw.push({ type: 'new', id, cat: 'new', minR: 0 });
    if (tw.length) { const o = tw[Math.floor(Math.random() * tw.length)]; o.rar = rollRarity(0, true); o.bonus = true; opts.push(o); }
  }
  return opts;
}
function openLevelUp(chest = false) {
  if (G.state !== 'play') return;
  G.state = 'levelup';
  G.offerChest = chest;
  currentOffer = buildOffer(chest);
  banishMode = false;
  renderCards();
  $('rerolls').textContent = G.rerolls; $('banishes').textContent = G.banishes;
  $('reroll').disabled = G.rerolls <= 0; $('banish').disabled = G.banishes <= 0;
  document.querySelector('#levelup .lvtitle').textContent = chest ? 'SOULSTONE CHEST' : 'LEVEL UP';
  show('levelup', true);
  play(chest ? 'UIChestOpen03' : 'UIStar', { vol: 0.6 });
}
function cardInfo(o) {
  const R = RARITY[o.rar];
  if (o.type === 'up') {
    const sk = o.sk, mult = R.m;
    if ((sk.lv === 2 || sk.lv === 4) && PATHS[sk.id]) return { title: sk.def.name, kind: `Skill · Level ${sk.lv} → ${sk.lv + 1} · PATH CHOICE`, desc: sk.def.lv[sk.lv - 1] + `<br><br><span style="color:#7fd8ff">Choose a top, middle or bottom BTD6 path</span>`, icon: sk.def.icon, tags: sk.def.tags };
    return { title: sk.def.name, kind: `Skill · Level ${sk.lv} → ${sk.lv + 1}`, desc: sk.def.lv[sk.lv - 1] + (o.rar > 0 ? `<br><br><span style="color:var(--gold2)">+${Math.round((mult - 1) * 15)}% skill damage</span>` : ''), icon: sk.def.icon, tags: sk.def.tags };
  }
  if (o.type === 'new') { const d = SKILLS[o.id]; return { title: d.name, kind: 'New Skill', desc: d.desc, icon: d.icon, tags: d.tags }; }
  if (o.type === 'path') {
    const names = PATHS[o.sk.id][{ T: 0, M: 1, B: 2 }[o.L]], t = o.tier === 0 ? 0 : 1;
    const line = names.slice(t).map((n, i) => i ? `<span style="color:var(--dim)">→ ${n}</span>` : `<b>${n}</b>`).join('<br>');
    return { title: names[t], kind: `${o.sk.def.name} · ${PATH_NAME[o.L]}`, desc: `${line}<br><br><span style="color:var(--gold2)">${PATH_BONUS[o.L]}</span>`, icon: o.sk.def.icon, upg: PATH_ICON[`${o.sk.id}_${o.L}${o.tier === 0 ? 3 : 4}`], tags: o.sk.def.tags };
  }
  if (o.type === 'paragon') return { title: PARAGONS[o.sk.id], kind: `PARAGON · merge ${o.sk.def.name}`, desc: `Your three maxed towers lend their power: ${o.sk.def.name} becomes its Paragon.<br><br><span style="color:var(--gold2)">x3 damage · 40% faster attacks · Paragon model</span>`, icon: o.sk.def.icon, tags: o.sk.def.tags };
  const v = o.c.v * R.m;
  return { title: o.c.name, kind: o.c.tag ? `${TAGNAME[o.c.tag]} Upgrade` : 'Attribute', desc: o.c.fmt(v), icon: o.c.icon || ['UpgradeIcon'], tags: o.c.tag ? [o.c.tag] : [], v };
}
function renderCards() {
  const box = $('cards'); box.innerHTML = '';
  const frame = 'assets/ui/' + (banishMode ? 'Skill_Selection_Banish' : 'Skill_Selection_SpecialSource') + '.png';
  currentOffer.forEach((o, i) => {
    const R = RARITY[o.rar], info = cardInfo(o);
    const el = document.createElement('div');
    el.className = 'card' + (banishMode ? ' banishing' : '');
    el.style.setProperty('--c', R.c); el.style.setProperty('--frame', `url("${frame}")`);
    if (o.bonus) el.classList.add('bonus');
    el.innerHTML = `${o.bonus ? '<div class="bonustag">BONUS</div>' : ''}<div class="rar">${R.name}</div><canvas width="128" height="128"></canvas><div class="cn">${info.title}</div><div class="ck">${info.kind}</div><div class="cd">${info.desc}</div><div class="tags">${(info.tags || []).map(t => TAGNAME[t]).join(' · ')} &nbsp; [${i + 1}]</div>`;
    const c = el.querySelector('canvas');
    if (info.upg) { const im = new Image(); im.onload = () => { const g = c.getContext('2d'); g.clearRect(0, 0, c.width, c.height); const k = Math.min(c.width / im.width, c.height / im.height) * 0.9; g.drawImage(im, (c.width - im.width * k) / 2, (c.height - im.height * k) / 2, im.width * k, im.height * k); }; im.src = 'assets/ui/upg/' + info.upg + '.png'; }
    if (info.upg) { /* drawn on load */ }
    else if (o.type === 'stat' && !info.icon.some(n => sprite(n))) drawStatIcon(c, o.c, R);
    else spriteToCanvas(c, pickSpr(info.icon), '#b98');
    el.onclick = () => chooseCard(o, info);
    box.appendChild(el);
  });
  $('banishhint').textContent = banishMode ? 'Click a card to banish it from this run (it will never appear again).' : '';
}
function drawStatIcon(c, card, R) {
  const g = c.getContext('2d'), w = c.width;
  g.clearRect(0, 0, w, w);
  const grd = g.createRadialGradient(w / 2, w / 2, 4, w / 2, w / 2, w / 2);
  grd.addColorStop(0, '#fff3'); grd.addColorStop(1, '#0000'); g.fillStyle = grd; g.fillRect(0, 0, w, w);
  const glyph = { dmg: '⚔', cdr: '⚡', area: '◎', crit: '✦', critm: '☠', hp: '❤', regen: '✚', spd: '➶', magnet: '◉', xp: '✧', armor: '⛨', pierce: '➹', multi: '⋔', dur: '⌛' }[card.id] || { proj: '➹', area: '◎', fire: '🔥', frost: '❄', lightning: 'ϟ', summon: '♜', trap: '✷' }[card.tag] || '★';
  g.font = `bold ${w * 0.55}px serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--' + RARITY.indexOf(R) === -1 ? 'gold' : 'gold') || '#f4c35a';
  g.shadowColor = '#000'; g.shadowBlur = 8; g.fillStyle = '#ffe39a'; g.fillText(glyph, w / 2, w / 2 + 4);
}
function chooseCard(o, info) {
  if (banishMode && o.type === 'path') banishMode = false;
  if (banishMode) {
    if (G.banishes <= 0) return;
    G.banishes--; banishMode = false;
    G.banished.add(o.type === 'paragon' ? 'para_' + o.sk.id : o.type === 'up' ? 'up_' + o.sk.id : o.type === 'new' ? 'new_' + o.id : 'stat_' + o.c.id);
    const idx = currentOffer.indexOf(o);
    const repl = buildOffer(G.offerChest).find(x => !x.bonus && !currentOffer.some(y => sameCard(x, y)));
    if (repl) currentOffer[idx] = repl; else currentOffer.splice(idx, 1);
    $('banishes').textContent = G.banishes; $('banish').disabled = G.banishes <= 0; $('banish').classList.remove('on');
    renderCards(); return;
  }
  const R = RARITY[o.rar];
  if (o.type === 'paragon') {
    const sk = o.sk; sk.lv = 8; sk.paragon = true;
    sk.def = Object.assign({}, sk.def, { name: PARAGONS[sk.id], dmg: sk.def.dmg * 3, cd: sk.def.cd * 0.6 });
    const tp = G.towerPos[sk.id] || G.player;
    G.effects.push({ kind: 'ring', x: tp.x, y: tp.y, r: 6, t: 0, life: 0.8, color: '#ffe680' }, { kind: 'expl', x: tp.x, y: tp.y, r: 2.5, t: 0, life: 0.8 });
    shake(0.5); META.ach('paragon'); toast(`PARAGON: ${PARAGONS[sk.id]}!`, '#ffe680'); play('UpgradeParagonDartMonkey', { vol: 0.9 });
  } else if (o.type === 'up' && (o.sk.lv === 2 || o.sk.lv === 4) && PATHS[o.sk.id] && !o.pathPicked) {
    // levels 3 and 5: pick a BTD6 path (top / middle / bottom) before the upgrade lands
    const tier = o.sk.lv === 2 ? 0 : 1;
    currentOffer = ['T', 'M', 'B'].map(L => ({ type: 'path', sk: o.sk, L, tier, rar: o.rar, from: o }));
    G.pathPick = true; renderCards(); $('reroll').disabled = $('banish').disabled = true;
    document.querySelector('#levelup .lvtitle').textContent = 'CHOOSE A PATH';
    return;
  } else if (o.type === 'path') {
    const sk = o.sk; if (o.tier === 0) sk.path3 = o.L; else sk.path5 = o.L;
    G.pathPick = false; o.from.pathPicked = true; chooseCard(o.from, cardInfo(o.from)); return;
  } else if (o.type === 'up') { o.sk.lv++; G.stats.skillBonus = G.stats.skillBonus || {}; o.sk.def = Object.assign({}, o.sk.def, { dmg: o.sk.def.dmg * (1 + (R.m - 1) * 0.15) }); }
  else if (o.type === 'new') addSkill(o.id);
  else { o.c.apply(G.stats, info.v, G); const it = G.items[o.c.id] || (G.items[o.c.id] = { icon: o.c.icon, name: o.c.name, n: 0, card: o.c }); it.n++; it.rar = Math.max(it.rar || 0, o.rar); }
  play('UIClick01', { vol: 0.5 });
  show('levelup', false);
  G.state = 'play';
  if (G.offerChest) { G.pendingChest--; }
  else G.pendingLevels--;
  if ((G.pendingChest || 0) > 0) openLevelUp(true);
  else if (G.pendingLevels > 0) openLevelUp(false);
}
const sameCard = (a, b) => a.type === b.type && (a.type === 'up' || a.type === 'paragon' ? a.sk === b.sk : a.type === 'new' ? a.id === b.id : a.c === b.c);
$('reroll').onclick = () => { if (G.rerolls <= 0) return; G.rerolls--; currentOffer = buildOffer(G.offerChest); banishMode = false; renderCards(); $('rerolls').textContent = G.rerolls; $('reroll').disabled = G.rerolls <= 0; };
$('banish').onclick = () => { if (G.banishes <= 0) return; banishMode = !banishMode; $('banish').classList.toggle('on', banishMode); renderCards(); };

// ---------------------------------------------------------------- pause / end
function togglePause() {
  if (!G) return;
  if (G.state === 'play') { G.state = 'pause'; renderPause(); show('pause', true); }
  else if (G.state === 'pause') { G.state = 'play'; show('pause', false); }
}
// end-of-run table: what the hero and each tower contributed
function breakdownRows() {
  const R = G.runStats || {};
  const rows = [['hero', G.ch.name + ' (you)', G.ch.spr]].concat(G.skills.filter(sk => !sk.hero).map(sk => [sk.id, sk.def.name + ' ' + sk.lv, sk.def.icon]));
  for (const id in R) if (!rows.some(r => r[0] === id) && SKILLS[id]) rows.push([id, SKILLS[id].name, SKILLS[id].icon]);
  return rows.map(([id, name, icon]) => Object.assign({ id, name, icon }, { dmg: 0, pops: 0, gold: 0, xp: 0, heal: 0 }, R[id] || {})).sort((a, b) => b.dmg - a.dmg);
}
function renderBreakdownRows(el, rows) {
  const k = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'k' : Math.round(n).toLocaleString();
  const tot = rows.reduce((a, r) => a + r.dmg, 0) || 1;
  const extra = r => [r.gold ? `$${k(r.gold)}` : '', r.xp ? `${k(r.xp)} xp` : '', r.heal ? `${k(r.heal)} hp` : ''].filter(Boolean).join(' · ') || '—';
  el.innerHTML = `<div class="bh"><span></span><span>Source</span><span>Damage</span><span>Pops</span><span>Generated</span></div>` + rows.map(r =>
    `<div class="br"><canvas width="40" height="40"></canvas><span>${esc(r.name)}</span><span>${k(r.dmg)} <i style="--w:${Math.round(r.dmg / tot * 100)}%"></i></span><span>${k(r.pops)}</span><span>${extra(r)}</span></div>`).join('');
  el.querySelectorAll('canvas').forEach((c, i) => { const ic = rows[i].icon; if (ic) spriteToCanvas(c, pickSpr(ic), '#a7794a'); });
}
const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function renderBreakdown(el) { renderBreakdownRows(el, breakdownRows()); }
function oldRenderBreakdown(el) {
  const R = G.runStats || {}, k = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'k' : Math.round(n).toLocaleString();
  const rows = [['hero', G.ch.name + ' (you)', G.ch.spr]].concat(G.skills.filter(sk => !sk.hero).map(sk => [sk.id, sk.def.name + ' ' + sk.lv, sk.def.icon]));
  for (const id in R) if (!rows.some(r => r[0] === id) && SKILLS[id]) rows.push([id, SKILLS[id].name, SKILLS[id].icon]);
  const tot = rows.reduce((a, r) => a + ((R[r[0]] || {}).dmg || 0), 0) || 1;
  rows.sort((a, b) => ((R[b[0]] || {}).dmg || 0) - ((R[a[0]] || {}).dmg || 0));
  const extra = r => [r.gold ? `$${k(r.gold)}` : '', r.xp ? `${k(r.xp)} xp` : '', r.heal ? `${k(r.heal)} hp` : ''].filter(Boolean).join(' · ') || '—';
  el.innerHTML = `<div class="bh"><span></span><span>Source</span><span>Damage</span><span>Pops</span><span>Generated</span></div>` + rows.map(([id, name, icon]) => {
    const r = R[id] || { dmg: 0, pops: 0 }, sh = r.dmg / tot;
    return `<div class="br"><canvas width="40" height="40"></canvas><span>${name}</span><span>${k(r.dmg)} <i style="--w:${Math.round(sh * 100)}%"></i></span><span>${k(r.pops)}</span><span>${extra(r)}</span></div>`;
  }).join('');
  el.querySelectorAll('canvas').forEach((c, i) => { const ic = rows[i][2]; if (ic) spriteToCanvas(c, pickSpr(ic), '#a7794a'); });
}
// ---------------------------------------------------------------- highscores
// Saved locally in this browser; set window.HS_CONFIG = { url, key } (highscores_config.js) to share them through Supabase.
const HS_CATS = [
  { id: 'damage', name: 'Top Damage', fmt: v => Math.round(v).toLocaleString() },
  { id: 'pops', name: 'Top Pops', fmt: v => Math.round(v).toLocaleString() },
  { id: 'cash', name: 'Top Cash Earned', fmt: v => '$' + Math.round(v).toLocaleString() },
  { id: 'loops', name: 'Total Loops', fmt: v => v },
  { id: 'level', name: 'Level', fmt: v => v },
];
function runRecord(win, quit, mm) {
  const statRows = [];
  const s = G.stats;
  statRows.push(['Time', fmtTime(G.t)], ['Level', G.level], ['Loops', G.loop], ['Bosses defeated', G.bossKills], ['Bloons popped', G.kills], ['Layers popped', G.pops], ['Damage dealt', Math.round(G.dmgDealt).toLocaleString()],
    ['Gold earned', '$' + Math.round(G.goldEarned).toLocaleString()], ['Damage', '+' + pct(s.dmg - 1)], ['Attack speed', '+' + pct(s.cdr)], ['Area', '+' + pct(s.area - 1)],
    ['Crit', pct(s.crit) + ' (x' + s.critMult.toFixed(2) + ')'], ['Max HP', Math.round(s.maxhp)], ['Luck', s.luck], ['Dashes', s.dashes], ['Skills', G.skills.map(k => `${k.def.name} ${k.lv}`).join(', ')]);
  const sk = selectedSkin(G.ch);
  return { v: 1, date: Date.now(), hero: G.ch.id, heroName: G.ch.name, icon: sk ? sk.icon : HERO_ICON[G.ch.id], map: G.arena.def.name || G.arena.def.id, chaos: CHAOS[G.chaosIdx].n,
    result: win ? (quit ? 'Run complete' : 'Fallen in glory') : quit ? 'Abandoned' : 'Defeated',
    damage: Math.round(G.dmgDealt), pops: G.pops, cash: Math.round(G.goldEarned), loops: G.loop, level: G.level, time: Math.round(G.t),
    stats: statRows, breakdown: breakdownRows().map(r => ({ id: r.id, name: r.name, icon: r.icon, dmg: Math.round(r.dmg), pops: r.pops, gold: Math.round(r.gold), xp: Math.round(r.xp), heal: Math.round(r.heal) })) };
}
const HS = {
  get shared() { return !!(window.HS_CONFIG && HS_CONFIG.url && HS_CONFIG.key); },
  local() { try { return JSON.parse(localStorage.getItem('bss_scores') || '[]'); } catch (e) { return []; } },
  saveLocal(list) { try { localStorage.setItem('bss_scores', JSON.stringify(list.slice(-500))); } catch (e) { } },
  async add(rec) {
    const L = this.local(); L.push(rec); this.saveLocal(L);
    if (this.shared) {
      try {
        await fetch(HS_CONFIG.url.replace(/\/$/, '') + '/rest/v1/scores', { method: 'POST', headers: { apikey: HS_CONFIG.key, Authorization: 'Bearer ' + HS_CONFIG.key, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ name: rec.name, hero: rec.hero, damage: rec.damage, pops: rec.pops, cash: rec.cash, loops: rec.loops, level: rec.level, data: rec }) });
      } catch (e) { console.warn('highscore upload failed', e); }
    }
  },
  async top(cat) {
    if (this.shared) {
      try {
        const r = await fetch(HS_CONFIG.url.replace(/\/$/, '') + `/rest/v1/scores?select=data&order=${cat}.desc,created_at.asc&limit=10`, { headers: { apikey: HS_CONFIG.key, Authorization: 'Bearer ' + HS_CONFIG.key } });
        if (r.ok) return (await r.json()).map(x => x.data);
      } catch (e) { console.warn('highscore fetch failed', e); }
    }
    return this.local().sort((a, b) => (b[cat] - a[cat]) || (a.date - b.date)).slice(0, 10);
  },
};
function askName(rec) {
  if (!G || G.state !== 'end') return;
  $('hsnsum').textContent = `${rec.heroName} · Level ${rec.level} · ${rec.loops} loop${rec.loops === 1 ? '' : 's'} · ${rec.damage.toLocaleString()} damage · ${rec.pops.toLocaleString()} pops · $${rec.cash.toLocaleString()}`;
  const inp = $('hsninput'); try { inp.value = localStorage.getItem('bss_name') || ''; } catch (e) { }
  show('hsname', true); setTimeout(() => { inp.focus(); inp.select(); }, 50);
  const done = async submit => {
    show('hsname', false); inp.onkeydown = null;
    if (!submit) return;
    rec.name = (inp.value.trim() || 'Monkey').slice(0, 16);
    try { localStorage.setItem('bss_name', rec.name); } catch (e) { }
    await HS.add(rec); toastDom('Saved to highscores!');
  };
  $('hsnok').onclick = () => done(true); $('hsnskip').onclick = () => done(false);
  inp.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') done(true); else if (e.key === 'Escape') done(false); };
}
function toastDom(t) { const el = $('endbanner'); if (!el) return; const o = el.textContent; el.textContent = t; setTimeout(() => { el.textContent = o; }, 1600); }
let hsCat = 'damage';
async function openScores() {
  show('scores', true); play('UIClick01', { vol: 0.5 });
  $('hsmode').textContent = HS.shared ? 'Shared online leaderboard' : 'Scores saved on this computer';
  const tabs = $('hstabs'); tabs.innerHTML = '';
  HS_CATS.forEach(c => { const el = document.createElement('div'); el.className = 'chip' + (c.id === hsCat ? ' sel' : ''); el.textContent = c.name; el.onclick = () => { hsCat = c.id; openScores(); }; tabs.appendChild(el); });
  const box = $('hslist'); box.innerHTML = '<div class="hsempty">Loading…</div>';
  const cat = HS_CATS.find(c => c.id === hsCat), list = await HS.top(hsCat);
  if (!list.length) { box.innerHTML = '<div class="hsempty">No runs yet — finish a run and submit your name!</div>'; return; }
  box.innerHTML = '';
  list.forEach((r, i) => {
    const el = document.createElement('div'); el.className = 'hsrow';
    el.innerHTML = `<div class="rk">${i + 1}</div><img src="${heroIconSrc(r.icon || HERO_ICON[r.hero])}"><div><div class="nm">${esc(r.name || 'Monkey')}</div><div class="meta">${esc(r.heroName || '')} · ${esc(r.map || '')} · Chaos ${esc(r.chaos || '')}</div></div><div class="meta">${new Date(r.date).toLocaleDateString()} · ${esc(r.result || '')}</div><div class="val">${cat.fmt(r[hsCat] || 0)}</div>`;
    el.querySelector('.nm').onclick = () => openRunView(r);
    box.appendChild(el);
  });
}
function openRunView(r) {
  play('UIClick01', { vol: 0.5 });
  $('rvname').textContent = r.name || 'Monkey';
  $('rvsub').textContent = `${r.heroName} · ${r.map} · Chaos ${r.chaos} · ${r.result} · ${new Date(r.date).toLocaleString()}`;
  $('rvstats').innerHTML = (r.stats || []).map(([a, b]) => `<span>${esc(a)}</span><b>${esc(b)}</b>`).join('');
  renderBreakdownRows($('rvbreak'), r.breakdown || []);
  show('runview', true);
}
$('hsbtn').onclick = openScores;
$('hsclose').onclick = () => show('scores', false);
$('rvclose').onclick = () => show('runview', false);
$('scores').onclick = e => { if (e.target.id === 'scores') show('scores', false); };
$('runview').onclick = e => { if (e.target.id === 'runview') show('runview', false); };
$('hsexport').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(HS.local(), null, 1)], { type: 'application/json' })); a.download = 'bloonstone_highscores.json'; a.click(); };
$('hsimport').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try { const add = JSON.parse(await f.text()); if (!Array.isArray(add)) throw 0; const L = HS.local(), seen = new Set(L.map(x => x.date + x.name));
    for (const r of add) if (r && r.date && !seen.has(r.date + r.name)) L.push(r); HS.saveLocal(L); openScores(); } catch (err) { alert('That file is not a highscores export.'); }
  e.target.value = '';
};
function renderStats(el, extra = []) {
  const s = G.stats;
  const rows = [
    ['Time', fmtTime(G.t)], ['Level', G.level], ['Bloons popped', G.kills], ['Damage dealt', Math.round(G.dmgDealt).toLocaleString()],
    ['Damage', '+' + pct(s.dmg - 1)], ['Attack speed', '+' + pct(s.cdr)], ['Area', '+' + pct(s.area - 1)],
    ['Crit', pct(s.crit) + ' (x' + s.critMult.toFixed(2) + ')'], ['Max HP', Math.round(s.maxhp)], ['Armor', s.armor],
    ['Skills', G.skills.map(k => `${k.def.name} ${k.lv}`).join(', ')], ...extra,
  ];
  el.innerHTML = rows.map(([a, b]) => `<span>${a}</span><b>${b}</b>`).join('');
}
$('resume').onclick = togglePause;
$('quit').onclick = () => { show('pause', false); endRun(false, true); };
function endRun(win, quit = false) {
  if (G.state === 'end') return;
  G.state = 'end';
  const key = `${G.arena.def.id}_${G.chaosIdx}`;
  let rec = '';
  if (G.bossKills > 0) win = true;
  if (win && BEST[key] && Math.abs(BEST[key] - (G.bestThisRun || -1)) < 0.01) rec = 'NEW BEST TIME!';
  const eb = $('endbanner');
  eb.style.backgroundImage = `url("assets/ui/GameOver_Frame_01.png")`;
  $('endskull').style.display = win ? 'none' : 'block';
  eb.textContent = win ? (quit ? 'RUN COMPLETE' : 'FALLEN IN GLORY') : quit ? 'RUN ABANDONED' : 'DEFEATED';
  eb.style.color = win ? '#ffe39a' : '#ff7a7a';
  const mm = Math.round((G.goldEarned / 20 + G.level * 4 + G.bossKills * 150 + G.t / 6) * META.mmMult());
  PROFILE.mm += mm; saveProfile();
  renderStats($('endstats'), [['Monkey Money earned', '+' + mm + '  (total ' + Math.floor(PROFILE.mm) + ')'], ['Bosses defeated', G.bossKills], ['Gold earned', '$' + Math.round(G.goldEarned).toLocaleString()], ...(rec ? [['Record', rec]] : [])]);
  renderBreakdown($('endbreak'));
  const runRec = runRecord(win, quit, mm);
  setTimeout(() => askName(runRec), win ? 400 : 1100);
  setTimeout(() => show('end', true), win ? 200 : 900);
}
$('again').onclick = () => { show('end', false); G = null; R3.resetRun(); buildMenu(); show('menu', true); startMenuMusic(); };

// ---------------------------------------------------------------- profile: Monkey Money + skins
// purchase confirmation: previews the skin on the stage and asks before spending Monkey Money
function confirmSkin(ch, s) {
  const box = $('buyskin'), can = PROFILE.mm >= s.cost;
  $('bsicon').src = heroIconSrc(s.icon); $('bsname').textContent = s.name; $('bshero').textContent = ch.name + ' skin';
  $('bscost').textContent = s.cost.toLocaleString();
  $('bsbal').textContent = can ? `You have ${PROFILE.mm.toLocaleString()} · ${(PROFILE.mm - s.cost).toLocaleString()} left after` : `You have ${PROFILE.mm.toLocaleString()} — need ${(s.cost - PROFILE.mm).toLocaleString()} more`;
  $('bsok').disabled = !can; $('bsok').textContent = can ? 'BUY' : 'NOT ENOUGH';
  R3.setPreview(s.key); buildMenu.pk = s.key;
  play('UIClick01', { vol: 0.5 });
  box.classList.remove('hidden');
  const close = () => { box.classList.add('hidden'); document.removeEventListener('keydown', onKey, true); buildMenu.pk = null; buildMenu(); };
  const onKey = e => { if (e.code === 'Escape') { e.stopPropagation(); close(); } else if (e.code === 'Enter' && can) { e.stopPropagation(); $('bsok').click(); } };
  document.addEventListener('keydown', onKey, true);
  $('bscancel').onclick = () => { play('UIClick01', { vol: 0.4 }); close(); };
  box.onclick = e => { if (e.target === box) close(); };
  $('bsok').onclick = () => {
    if (PROFILE.mm < s.cost) return;
    PROFILE.mm -= s.cost; PROFILE.owned.push(s.key); PROFILE.skin[ch.id] = s.key; saveProfile();
    play('UIChestOpen03', { vol: 0.8 }); close();
  };
}
const HERO_ICON = { quincy: 'HeroIconQuincy', gwen: 'HeroIconGwendolin', striker: 'HeroIconStrikerJones', obyn: 'HeroIconObynGreenFoot', rosalia: 'HeroIconRosalia', churchill: 'HeroIconChurchill',
  benjamin: 'HeroIconBenjamin', pat: 'HeroIconPatFusty', ezili: 'HeroIconEzili', adora: 'HeroIconAdora', brickell: 'HeroIconAdmiralBrickell', etienne: 'HeroIconEtienne', sauda: 'HeroIconSauda',
  psi: 'HeroIconPsi', geraldo: 'HeroIconGeraldo', corvus: 'HeroIconCorvus', silas: 'HeroIconSilas' };
const SKINS = [
  ['CyberQuincy', 'Cyber Quincy', 'quincy', 'HeroIconQuincyCyber', 600], ['WolfPack', 'Wolfpack Quincy', 'quincy', 'HeroIconWolfpackQuincy', 900],
  ['CircusGwendolin', 'Harlegwen', 'gwen', 'HeroIconGwendolinCircus', 600], ['FirecrackerGwendolin', 'Firecracker Gwen', 'gwen', 'HeroIconGwendolinFirecracker', 700], ['ScientistGwendolin', 'Scientist Gwendolin', 'gwen', 'HeroIconGwendolinScientist', 800],
  ['BikerBones', 'Biker Bones', 'striker', 'HeroIconStrikerJonesBikerBones', 600], ['OctoJones', 'Octo Jones', 'striker', 'HeroIconStrikerJonesOctoJones', 800],
  ['MountainGuardian', 'Mountain Obyn', 'obyn', 'HeroIconMountainObyn', 700], ['ObynOceanGuardian', 'Ocean Guardian Obyn', 'obyn', 'HeroIconObynOceanGuardian', 600], ['ObynSkeletor', 'Skeletor', 'obyn', 'HeroIconObynSkeletor', 1000],
  ['RosaliaTinkerfairy', 'Tinkerfairy Rosalia', 'rosalia', 'HeroIconRosaliaTinkerfairy', 700],
  ['Sentai', 'Sentai Churchill', 'churchill', 'HeroIconChurchillSentai', 800], ['Sleigh', 'Sleigh Churchill', 'churchill', 'HeroIconChurchillSleigh', 600],
  ['BenJammin', 'DJ Benjammin\'', 'benjamin', 'HeroIconBenJammin', 600], ['SushiBento', 'Sushi Bento', 'benjamin', 'HeroIconSushiBento', 800],
  ['FustytheSnowman', 'Fusty the Snowman', 'pat', 'HeroIconFustyTheSnowman', 600], ['KaijuPat', 'Kaiju Pat', 'pat', 'HeroIconKaijuPat', 1000],
  ['Galaxili', 'Galaxili', 'ezili', 'HeroIconEziliGalaxili', 800], ['SmudgeCatt', 'Smudge Catt', 'ezili', 'HeroIconEziliSmudgeCatt', 600],
  ['JoanofArc', 'Joan of Arc', 'adora', 'HeroIconJoanOfArc', 700], ['SheRa', 'She-Ra', 'adora', 'HeroIconAdoraSheRa', 1000], ['Voidora', 'Voidora', 'adora', 'HeroIconVoidora', 900],
  ['DreadPirateBrickell', 'Dread Pirate Brickell', 'brickell', 'HeroIconAdmiralBrickellDreadPirateBrickell', 800], ['LifeguardBrickell', 'Lifeguard Brickell', 'brickell', 'HeroIconAdmiralBrickellLifeguardBrickell', 600],
  ['BookWyrmEtienne', 'Bookwyrm Etienne', 'etienne', 'HeroIconEtienneBookWyrm', 700], ['ETn', 'ETn', 'etienne', 'HeroIconETn', 800],
  ['JiangshiSauda', 'Jiangshi Sauda', 'sauda', 'HeroIconSaudaJiangshi', 800], ['RedSauda', 'Red Sauda', 'sauda', 'HeroIconSaudaRed', 600], ['VikingSauda', 'Viking Sauda', 'sauda', 'HeroIconSaudaViking', 700],
  ['Psimbals', 'Psimbals', 'psi', 'HeroIconPsiPsimbals', 700],
  ['GeraldoGentlemanGadgeteer', 'Gentleman Gadgeteer', 'geraldo', 'HeroIconGeraldoGentlemanGadgeteer', 800],
  ['CorvusDecryptor', 'Decryptor Corvus', 'corvus', 'HeroIconCorvusDecryptor', 800],
].map(([k, name, hero, icon, cost]) => ({ key: 's_' + k, name, hero, icon, cost: cost * 2 }));
let PROFILE = { mm: 0, owned: [], skin: {} };
try { PROFILE = Object.assign(PROFILE, JSON.parse(localStorage.getItem('bss_profile') || '{}')); } catch (e) { }
function saveProfile() { try { localStorage.setItem('bss_profile', JSON.stringify(PROFILE)); } catch (e) { } }
const heroIconSrc = n => 'assets/ui/heroes/' + n + '.png';
function selectedSkin(ch) { const k = PROFILE.skin[ch.id]; return k && PROFILE.owned.includes(k) ? SKINS.find(s => s.key === k) : null; }
// ---------------------------------------------------------------- sound settings (master / music / sfx / voice) + Soulstone menu music
let AUDIOSET = { master: 70, music: 60, sfx: 80, voice: 80 };
try { AUDIOSET = Object.assign(AUDIOSET, JSON.parse(localStorage.getItem('bss_audio') || '{}')); } catch (e) { }
const AUDIO_ROWS = [['master', 'Master'], ['music', 'Music'], ['sfx', 'Effects'], ['voice', 'Voices']];
let MUSIC = null;
function applyAudio() {
  const m = AUDIOSET.master / 100;
  if (SND.master) { SND.master.gain.value = 0.8 * m; SND.sfxG.gain.value = AUDIOSET.sfx / 100; SND.voG.gain.value = AUDIOSET.voice / 100; }
  if (MUSIC) MUSIC.volume = Math.min(1, 0.6 * m * AUDIOSET.music / 100 * (MUSIC.fade ?? 1));
}
function buildAudioUI(box) {
  box.innerHTML = '';
  for (const [k, label] of AUDIO_ROWS) {
    const row = document.createElement('label'); row.className = 'arow';
    row.innerHTML = `<span>${label}</span><input type="range" min="0" max="100" value="${AUDIOSET[k]}"><b>${AUDIOSET[k]}</b>`;
    const inp = row.querySelector('input'), val = row.querySelector('b');
    inp.oninput = () => { audio(); sndInit(); AUDIOSET[k] = +inp.value; val.textContent = inp.value; applyAudio(); try { localStorage.setItem('bss_audio', JSON.stringify(AUDIOSET)); } catch (e) { } if (k === 'music') startMenuMusic(); };
    inp.onchange = () => { if (k === 'sfx') play('Pop0*', { vol: 0.8, gap: 0 }); if (k === 'voice') play('SelectQuincy0*', { vol: 1.2, gap: 0, bus: 'vo' }); };
    box.appendChild(row);
  }
}
// Soulstone Survivors main-menu theme (mixed down from its Wwise music stems)
function startMenuMusic() {
  if (!window.BSS_MUSIC || !window.BSS_MUSIC.menu) return;
  if (!MUSIC) { MUSIC = new Audio(window.BSS_MUSIC.menu); MUSIC.loop = false; MUSIC.addEventListener('ended', () => { MUSIC.currentTime = 8; MUSIC.play().catch(() => { }); }); }
  if (MUSIC.fadeT) { clearInterval(MUSIC.fadeT); MUSIC.fadeT = null; }
  MUSIC.fade = 1; applyAudio();
  if (MUSIC.paused) MUSIC.play().catch(() => { });
}
function stopMenuMusic() {
  if (!MUSIC || MUSIC.paused) return;
  if (MUSIC.fadeT) clearInterval(MUSIC.fadeT);
  MUSIC.fadeT = setInterval(() => { MUSIC.fade = Math.max(0, (MUSIC.fade ?? 1) - 0.05); applyAudio(); if (MUSIC.fade <= 0) { clearInterval(MUSIC.fadeT); MUSIC.fadeT = null; MUSIC.pause(); } }, 60);
}
// browsers only allow audio after a user gesture: start the menu theme on the first click/key while on the menu
addEventListener('pointerdown', () => { if (!G) { audio(); sndInit(); startMenuMusic(); } });
addEventListener('keydown', () => { if (!G) { audio(); sndInit(); startMenuMusic(); } });

// ---------------------------------------------------------------- menu
function buildMenu() {
  $('mmv').textContent = Math.floor(PROFILE.mm).toLocaleString();
  const ch = CHARS[menuSel.char] || CHARS[0];
  const cbox = $('chars'); cbox.innerHTML = '';
  CHARS.forEach((c, i) => {
    const sk = selectedSkin(c);
    const el = document.createElement('div'); el.className = 'htile' + (i === menuSel.char ? ' sel' : '');
    const owned = SKINS.filter(s => s.hero === c.id && PROFILE.owned.includes(s.key)).length, total = SKINS.filter(s => s.hero === c.id).length;
    const locked = !heroUnlocked(c.id);
    if (locked) el.classList.add('locked');
    el.innerHTML = `<img src="${heroIconSrc(sk ? sk.icon : HERO_ICON[c.id])}"><div class="nm">${c.name}</div>${locked ? '<div class="lock">🔒</div>' : total ? `<div class="dot">${owned}/${total}</div>` : ''}`;
    el.title = locked ? (nextUnlock() === c.id ? 'Defeat a boss to unlock' : `Unlocks after ${UNLOCK_ORDER.indexOf(c.id) - UNLOCK_ORDER.indexOf(nextUnlock()) + 1} more boss kills`) : c.name;
    el.onclick = () => { menuSel.char = i; saveSel(); play('UIClick01', { vol: 0.5 }); buildMenu(); };
    cbox.appendChild(el);
  });
  // hero details + 3D preview
  const sk = selectedSkin(ch);
  $('hname').textContent = ch.name + (heroUnlocked(ch.id) ? '' : ' 🔒');
  { const lk = !heroUnlocked(ch.id); $('start').disabled = lk; $('start').textContent = lk ? (nextUnlock() === ch.id ? 'DEFEAT A BOSS TO UNLOCK' : `LOCKED · ${UNLOCK_ORDER.indexOf(ch.id) - UNLOCK_ORDER.indexOf(nextUnlock()) + 1} BOSS KILLS`) : 'BEGIN RUN'; }
  $('hskin').textContent = sk ? sk.name : 'Classic';
  $('hdesc').textContent = ch.desc;
  $('hhp').style.width = Math.min(100, ch.hp / 1.7) + '%';
  $('hspd').style.width = Math.min(100, (ch.spd - 5) / 2.2 * 100) + '%';
  spriteToCanvas($('htower'), pickSpr(ch.spr), '#a7794a');
  $('htowern').textContent = HERO_ATK[ch.id].name + ' — ' + HERO_ATK[ch.id].desc;
  R3.previewInit($('preview'));
  const pk = sk ? sk.key : ch.model;
  if (buildMenu.pk !== pk) { buildMenu.pk = pk; R3.setPreview(pk); }
  // skins
  const sbox = $('skins'); sbox.innerHTML = '';
  const list = [{ key: null, name: 'Classic', icon: HERO_ICON[ch.id], cost: 0 }, ...SKINS.filter(s => s.hero === ch.id)];
  list.forEach(s => {
    const owned = !s.key || PROFILE.owned.includes(s.key), sel = (sk ? sk.key : null) === s.key;
    const el = document.createElement('div'); el.className = 'skin' + (sel ? ' sel' : '') + (owned ? '' : ' locked') + (!owned && PROFILE.mm < s.cost ? ' cant' : '');
    el.innerHTML = `<img src="${heroIconSrc(s.icon)}"><div class="nm">${s.name}</div>${owned ? '' : `<div class="cost"><img src="assets/ui/heroes/mm.png">${s.cost}</div>`}`;
    el.title = owned ? 'Equip ' + s.name : `Unlock ${s.name} for ${s.cost} Monkey Money`;
    el.onclick = () => {
      if (!owned) { confirmSkin(ch, s); return; }
      play('UIClick01', { vol: 0.5 });
      PROFILE.skin[ch.id] = s.key; saveProfile(); buildMenu();
    };
    sbox.appendChild(el);
  });
  // maps
  const mbox = $('maps'); mbox.innerHTML = '';
  MAPS.forEach((m, i) => {
    const el = document.createElement('div'); el.className = 'mitem' + (i === menuSel.map ? ' sel' : '');
    const best = BEST[`${m.id}_${menuSel.chaos}`];
    el.innerHTML = `<canvas width="148" height="100"></canvas><div><div class="nm">${m.name}</div><div class="ds">${best ? 'Best: ' + fmtTime(best) : 'Not yet beaten'}</div></div>`;
    drawMapThumb(el.querySelector('canvas'), m);
    el.onclick = () => { menuSel.map = i; saveSel(); play('UIClick01', { vol: 0.5 }); buildMenu(); };
    mbox.appendChild(el);
  });
  const gq = $('gfx'); gq.innerHTML = ''; gfxChips(gq, buildMenu);
  const chx = $('chaos'); chx.innerHTML = '';
  CHAOS.forEach((c, i) => {
    const el = document.createElement('div'); el.className = 'chip' + (i === menuSel.chaos ? ' sel' : '');
    el.textContent = c.n; el.title = `Chaos ${c.n}: bloon HP x${c.hp}, damage x${c.dmg}, spawn rate x${c.rate}`;
    el.onclick = () => { menuSel.chaos = i; saveSel(); buildMenu(); };
    chx.appendChild(el);
  });
  buildAudioUI($('aud'));
}
function gfxChips(box, after) {
  ['Auto', 'High', 'Medium', 'Low'].forEach(q => {
    const el = document.createElement('div'); el.className = 'chip' + (R3.getQuality() === q ? ' sel' : '');
    el.textContent = q; el.title = { Auto: 'Adjusts resolution to keep ~60 FPS', High: 'Full resolution, soft shadows, antialiasing', Medium: 'Reduced resolution, basic shadows', Low: 'Low resolution, no shadows, less foliage' }[q];
    el.onclick = () => { R3.setQuality(q); box.innerHTML = ''; gfxChips(box, after); };
    box.appendChild(el);
  });
}


// ---------------------------------------------------------------- pause screen
function renderPause() {
  const sk = selectedSkin(G.ch);
  $('pportrait').src = heroIconSrc(sk ? sk.icon : HERO_ICON[G.ch.id]);
  $('psub').textContent = `${G.ch.name}${sk ? ' · ' + sk.name : ''} — ${G.arena.def.name} · Chaos ${G.chaos.n}`;
  const chips = [['Time', fmtTime(G.t)], ['Level', G.level], ['Loop', G.loop + 1], ['Gold', '$' + Math.floor(G.gold).toLocaleString()], ['Popped', G.kills.toLocaleString()], ['Bosses', G.bossKills], ['Chests', G.chests]];
  $('pchips').innerHTML = chips.map(([a, b]) => `<div>${a}<b>${b}</b></div>`).join('');
  const ps = $('pskills'); ps.innerHTML = '';
  for (const s of G.skills) {
    const el = document.createElement('div'); el.className = 'pskill';
    const nl = s.hero ? 5 : MAXLV, cur = s.hero ? G.stats.heroExtra : s.lv;
    el.innerHTML = `<canvas width="80" height="80"></canvas><div class="nm">${s.def.name}${s.hero ? ' <span style="color:#7fd8ff;font-size:10px">HERO ATTACK · x' + G.stats.heroDmg.toFixed(2) + ' dmg</span>' : ''}<div style="font-size:11px;color:var(--dim);font-weight:400">${!s.hero && s.lv > 1 ? s.def.lv[s.lv - 2] : s.def.desc}</div></div><div class="pips">${Array.from({ length: nl }, (_, i) => `<i class="${i < cur ? 'on' : ''}"></i>`).join('')}</div>`;
    spriteToCanvas(el.querySelector('canvas'), pickSpr(s.def.icon), '#a7794a');
    ps.appendChild(el);
  }
  const pr = $('prelics'); pr.innerHTML = (G.relics || []).length ? '' : '<span style="color:var(--dim);font-size:12px">No relics yet — they drop from chests, blimps and bosses</span>';
  for (const id of G.relics || []) { const r = relicById(id), S = r.set && RELIC_SETS[r.set]; const el = document.createElement('div'); el.className = 'pitem'; el.style.borderColor = S ? S.color : '#ffb02e'; el.title = `${r.name} — ${r.desc}${S ? ' (' + S.name + ' set)' : ''}`; el.innerHTML = `<img src="assets/ui/relic/${r.icon}.png" style="width:100%;height:100%;object-fit:contain">`; pr.appendChild(el); }
  $('psets').innerHTML = Object.entries(RELIC_SETS).map(([k, S]) => { const n = setCount(k); return n ? `<div style="color:${S.color}"><b>${S.name} ${n}/4</b> · <span style="opacity:${n >= 2 ? 1 : .5}">(2) ${S.b2}</span> · <span style="opacity:${n >= 4 ? 1 : .5}">(4) ${S.b4}</span></div>` : ''; }).join('');
  const pi = $('pitems'); pi.innerHTML = Object.keys(G.items).length ? '' : '<span style="color:var(--dim);font-size:12px">No items yet</span>';
  for (const it of Object.values(G.items)) {
    const el = document.createElement('div'); el.className = 'pitem'; el.title = it.name;
    el.style.borderColor = ['#9a9a9a', '#5fd35f', '#4aa3ff', '#c35cff', '#ffb02e'][it.rar || 0];
    el.innerHTML = `<canvas width="64" height="64"></canvas>${it.n > 1 ? `<b>x${it.n}</b>` : ''}`;
    const c = el.querySelector('canvas'), spn = (it.icon || []).find(n => sprite(n));
    if (spn) spriteToCanvas(c, spn, '#888'); else drawStatIcon(c, it.card, RARITY[it.rar || 0]);
    pi.appendChild(el);
  }
  renderStats($('pausestats'));
  const pg = $('pgfx'); pg.innerHTML = ''; gfxChips(pg);
  buildAudioUI($('paud'));
}
const thumbCache = {};
function drawMapThumb(c, m) {
  const g = c.getContext('2d');
  const draw = () => {
    g.fillStyle = m.tint; g.fillRect(0, 0, c.width, c.height);
    const k = Math.min(c.width / m.cols, c.height / m.rows) * 0.92;
    const ox = (c.width - m.cols * k) / 2, oy = (c.height - m.rows * k) / 2;
    if (!thumbCache[m.id]) {
      const a = { cols: m.cols, rows: m.rows };
      const mc = document.createElement('canvas'); mc.width = m.cols; mc.height = m.rows;
      const mg = mc.getContext('2d'), id = mg.createImageData(m.cols, m.rows), bin = atob(m.grid);
      for (let i = 0; i < m.cols * m.rows; i++) id.data[i * 4 + 3] = ((bin.charCodeAt(i >> 3) >> (7 - (i & 7))) & 1) ? 255 : 0;
      mg.putImageData(id, 0, 0); thumbCache[m.id] = mc;
    }
    const tmp = document.createElement('canvas'); tmp.width = c.width; tmp.height = c.height;
    const tg = tmp.getContext('2d');
    const fi = img(m.floor);
    if (fi.complete && fi.naturalWidth) { tg.fillStyle = tg.createPattern(fi, 'repeat'); tg.save(); tg.scale(0.12, 0.12); tg.fillRect(0, 0, c.width / 0.12, c.height / 0.12); tg.restore(); }
    else { tg.fillStyle = '#c8b48a'; tg.fillRect(0, 0, c.width, c.height); }
    tg.globalCompositeOperation = 'destination-in'; tg.drawImage(thumbCache[m.id], ox, oy, m.cols * k, m.rows * k);
    g.drawImage(tmp, 0, 0);
  };
  draw();
  const fi = img(m.floor); if (!fi.complete) fi.addEventListener('load', draw);
}
function saveSel() { try { localStorage.setItem('bss_sel', JSON.stringify(menuSel)); } catch (e) { } }
$('start').onclick = () => { audio(); stopMenuMusic(); newGame(); };

// ---------------------------------------------------------------- main loop
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  pollPad();
  if (G && G.state === 'play') update(dt);
  if (G && G.state !== 'loading') {
    renderWorld(G.state === 'play' ? dt : 0);
  } else {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H);
  }
  if (!$('menu').classList.contains('hidden')) R3.renderPreview(dt);
  requestAnimationFrame(frame);
}
function renderWorld(dt) { render(dt); }

// boot: wait for sprite sheets
Promise.race([Promise.all(SHEETS.map(s => s.complete ? 1 : new Promise(r => { s.addEventListener('load', r); s.addEventListener('error', r); }))), new Promise(r => setTimeout(r, 5000))]).then(() => {
  R3.init();
  document.querySelector('#loading .lvtitle').textContent = 'Inflating 3D bloons…';
  R3.loadModels().then(() => {
    show('loading', false);
    buildMenu();
    requestAnimationFrame(frame);
  }).catch(e => { document.querySelector('#loading .lvtitle').textContent = 'Model load failed: ' + e.message; console.error(e); });
});
