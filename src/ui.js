import { formatTime, ordinal } from './game/util.js';
import { PALETTES, ACCESSORIES, unlockHint } from './cosmetics.js';

const SCHEMA = [
  { section: 'Graphics' },
  { key: 'graphics', type: 'seg', label: 'Quality', options: [['auto', 'Auto'], ['low', 'Low'], ['medium', 'Med'], ['high', 'High']] },
  { key: 'shadows', type: 'toggle', label: 'Shadows' },
  { key: 'post', type: 'toggle', label: 'Bloom glow' },
  { key: 'trail', type: 'toggle', label: 'Speed lines & wake' },
  { key: 'splash', type: 'toggle', label: 'Splash effects' },
  { section: 'Controls' },
  { key: 'sensitivity', type: 'range', label: 'Steering sensitivity', min: 0.6, max: 1.6, step: 0.05 },
  { key: 'handedness', type: 'seg', label: 'Handedness', options: [['right', 'Right'], ['left', 'Left']] },
  { key: 'haptics', type: 'toggle', label: 'Vibration' },
  { section: 'Audio' },
  { key: 'sfx', type: 'toggle', label: 'Sound effects' },
  { key: 'music', type: 'toggle', label: 'Music' },
  { section: 'Gameplay' },
  { key: 'difficulty', type: 'seg', label: 'Rivals', options: [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']] },
  { key: 'practiceDefault', type: 'toggle', label: 'Practice mode by default' },
];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class UI {
  constructor(root, store, handlers) {
    this.root = root;
    this.store = store;
    this.h = handlers;
    this.cache = {};
    this.practice = !!store.settings.practiceDefault;
    this.returnTo = null;
    root.className = 'ui';
    root.innerHTML = this._template();
    const q = (s) => root.querySelector(s);
    this.el = {
      hud: q('.hud'), rankNum: q('.rank-num'), rankOf: q('.rank-of'), time: q('.hud-time'), progFill: q('.hud-progress i'),
      pct: q('.hud-progress-pct'), speed: q('.hud-speed b'), board: q('.hud-board'), mode: q('.hud-mode'), toast: q('.hud-toast'),
      hint: q('.hud-hint'), controls: q('.controls'), zone: q('.joy-zone'), base: q('.joy-base'), thumb: q('.joy-thumb'),
      jump: q('.jump-btn'), vignette: q('.edge-vignette'), countdown: q('.countdown'),
      menu: q('.menu'), settings: q('.settings'), character: q('.character'), pause: q('.pause'), end: q('.end'),
      best: q('.best'), practiceSwitch: q('[data-act="practice"]'), offline: q('.offline'), settingsBody: q('.settings .body'),
      swatches: q('.swatches'), chips: q('.chips'), hintline: q('.hintline'),
      endBadge: q('.end-badge'), endTitle: q('.end-title'), endTime: q('.end-time'), endBest: q('.end-best'), endList: q('.end-list'),
      endUnlock: q('.end-unlock'), endAgain: q('[data-act="again"]'),
    };
    this._renderSettings();
    this._renderCharacter();
    this.syncMenu();
    root.addEventListener('click', (e) => this._onClick(e));
    root.addEventListener('input', (e) => {
      const t = e.target;
      if (t.matches('input[type=range]')) {
        this.store.set(t.dataset.key, Number(t.value));
        this.h.onSetting?.(t.dataset.key, Number(t.value));
      }
    });
  }

  _template() {
    return `
    <div class="hud" hidden>
      <div class="hud-top">
        <div class="hud-rank"><span class="rank-num">1</span><span class="rank-of">/13</span><small>PLACE</small></div>
        <div class="hud-center"><div class="hud-time">0:00.00</div><div class="hud-progress"><i></i></div><div class="hud-progress-pct">0%</div></div>
        <div class="hud-right"><button class="btn-round" data-act="pause" aria-label="Pause"><i class="ico-pause"></i></button></div>
      </div>
      <div class="hud-speed"><b>0</b><small>km/h</small></div>
      <div class="hud-board"></div>
      <div class="hud-mode" hidden>PRACTICE</div>
      <div class="hud-toast"></div>
      <div class="hud-hint">JUMP!</div>
      <div class="hud-tips"></div>
      <div class="hud-keys">A / D or ← → steer &nbsp;·&nbsp; Space jump &nbsp;·&nbsp; Esc pause</div>
    </div>
    <div class="controls" hidden>
      <div class="joy-zone"><div class="joy-base"><div class="joy-thumb"></div></div></div>
      <button class="jump-btn" aria-label="Jump">JUMP</button>
    </div>
    <div class="edge-vignette"></div>
    <div class="countdown"></div>

    <section class="screen menu" hidden>
      <div class="card">
        <h1 class="logo">Splash <span>Rush</span></h1>
        <p class="tag">3D water slide racing · 13 riders · 1 winner</p>
        <div class="best"></div>
        <button class="btn big" data-act="play">Play Race</button>
        <div class="switch-row"><div>Practice mode<small>No elimination: respawn at checkpoints</small></div>
          <button class="switch" role="switch" data-act="practice" aria-checked="false" aria-label="Practice mode"></button></div>
        <div class="row2"><button class="btn alt" data-act="character">Character</button><button class="btn alt" data-act="settings">Settings</button></div>
        <div class="foot"><span class="offline">Loading…</span></div>
      </div>
    </section>

    <section class="screen modal settings" hidden>
      <div class="card"><h2>Settings</h2><div class="body scroll-y"></div>
        <div class="actions"><button class="btn alt danger" data-act="reset" style="flex:0 0 auto;padding:12px 14px;font-size:15px">Reset data</button><button class="btn" data-act="close-settings">Done</button></div></div>
    </section>

    <section class="screen modal character" hidden>
      <div class="card"><h2>Your rider</h2>
        <div class="body scroll-y">
          <div class="sec" style="margin-top:0">Colours</div><div class="swatches"></div>
          <div class="sec" style="margin-top:6px">Accessory</div><div class="chips"></div>
          <div class="hintline"></div>
        </div>
        <div class="actions"><button class="btn" data-act="close-character">Looks good</button></div></div>
    </section>

    <section class="screen modal pause" hidden>
      <div class="card"><h2>Paused</h2>
        <button class="btn" data-act="resume">Resume</button>
        <button class="btn alt" data-act="restart">Restart race</button>
        <button class="btn alt" data-act="settings">Settings</button>
        <button class="btn alt" data-act="quit">Main menu</button></div>
    </section>

    <section class="screen modal end" hidden>
      <div class="card">
        <div class="end-head">
          <div class="end-badge">1st</div><div class="end-title"></div>
          <div class="end-time"></div><div class="end-best"></div>
          <div class="end-unlock" hidden></div>
        </div>
        <div class="end-list scroll-y"></div>
        <div class="actions"><button class="btn" data-act="again">Race again</button><button class="btn alt" data-act="menu">Menu</button></div>
      </div>
    </section>`;
  }

  // ---------------------------------------------------------------- layout helpers
  setLayout(w, h) {
    const portrait = h >= w;
    const r = this.root.classList;
    r.toggle('portrait', portrait);
    r.toggle('landscape', !portrait);
    r.toggle('short', h < 430);
  }
  setTouch(on) { this.root.classList.toggle('touch', !!on); }
  setHanded(handedness) { this.root.classList.toggle('left-handed', handedness === 'left'); }

  // ---------------------------------------------------------------- screens
  show(name) {
    for (const k of ['menu', 'settings', 'character', 'pause', 'end']) this.el[k].hidden = k !== name;
    this.current = name;
  }
  hideScreens() { this.show(null); }

  hudVisible(on) {
    this.el.hud.hidden = !on;
    this.el.controls.hidden = !on;
    document.body.classList.toggle('playing', on);
  }

  _onClick(e) {
    const t = e.target.closest('[data-act], [data-set], [data-pal], [data-acc]');
    if (!t) return;
    const act = t.dataset.act;
    if (t.dataset.set) {
      const key = t.dataset.set;
      const val = t.dataset.val;
      this.store.set(key, val);
      this._syncSettings();
      this.h.onSetting?.(key, val);
      this.h.onClick?.();
      return;
    }
    if (t.dataset.tog) return;
    if (t.dataset.pal != null) return this._pickLook('pal', Number(t.dataset.pal));
    if (t.dataset.acc != null) return this._pickLook('acc', Number(t.dataset.acc));
    this.h.onClick?.();
    switch (act) {
      case 'play': this.h.onPlay?.(this.practice); break;
      case 'practice':
        this.practice = !this.practice;
        this.syncMenu();
        break;
      case 'settings': this.returnTo = this.current; this._syncSettings(); this.show('settings'); break;
      case 'close-settings': this.show(this.returnTo || 'menu'); break;
      case 'character': this.returnTo = this.current; this.el.hintline.textContent = ''; this._renderCharacter(); this.show('character'); this.h.onCharacterOpen?.(true); break;
      case 'close-character': this.show(this.returnTo || 'menu'); this.h.onCharacterOpen?.(false); break;
      case 'pause': this.h.onPause?.(); break;
      case 'resume': this.h.onResume?.(); break;
      case 'restart': this.h.onRestart?.(); break;
      case 'quit': case 'menu': this.h.onQuit?.(); break;
      case 'again': this.h.onAgain?.(); break;
      case 'reset':
        if (confirm('Reset best times, unlocks and stats on this device?')) { this.store.reset(); this._renderCharacter(); this.syncMenu(); this.h.onReset?.(); }
        break;
      default: break;
    }
  }

  // ---------------------------------------------------------------- menu
  syncMenu() {
    const b = this.store.profile.best;
    this.el.best.innerHTML = `<span>Best race <b>${formatTime(b.race)}</b></span><span>Practice <b>${formatTime(b.practice)}</b></span>`;
    this.el.practiceSwitch.setAttribute('aria-checked', String(this.practice));
  }
  setOffline(ready, text) {
    this.el.offline.textContent = text || (ready ? '✓ Ready to play offline' : 'Works offline after your first visit');
    this.el.offline.classList.toggle('off', !!ready);
  }

  // ---------------------------------------------------------------- settings
  _renderSettings() {
    let html = '';
    for (const it of SCHEMA) {
      if (it.section) { html += `<div class="sec">${it.section}</div>`; continue; }
      if (it.type === 'seg') {
        html += `<div class="set-row"><span>${it.label}</span><span class="seg" data-seg="${it.key}">${it.options.map(([v, l]) => `<button data-set="${it.key}" data-val="${v}" aria-pressed="false">${l}</button>`).join('')}</span></div>`;
      } else if (it.type === 'toggle') {
        html += `<div class="set-row"><span>${it.label}</span><button class="switch" role="switch" data-tog="${it.key}" aria-checked="false" aria-label="${it.label}"></button></div>`;
      } else if (it.type === 'range') {
        html += `<div class="set-row"><span>${it.label}</span><input type="range" data-key="${it.key}" min="${it.min}" max="${it.max}" step="${it.step}"></div>`;
      }
    }
    this.el.settingsBody.innerHTML = html;
    this.el.settingsBody.addEventListener('click', (e) => {
      const t = e.target.closest('[data-tog]');
      if (!t) return;
      const key = t.dataset.tog;
      const val = !this.store.settings[key];
      this.store.set(key, val);
      this._syncSettings();
      this.h.onSetting?.(key, val);
      this.h.onClick?.();
      if (key === 'practiceDefault') { this.practice = val; this.syncMenu(); }
    });
    this._syncSettings();
  }

  _syncSettings() {
    const s = this.store.settings;
    this.el.settingsBody.querySelectorAll('[data-set]').forEach((b) => b.setAttribute('aria-pressed', String(String(s[b.dataset.set]) === b.dataset.val)));
    this.el.settingsBody.querySelectorAll('[data-tog]').forEach((b) => b.setAttribute('aria-checked', String(!!s[b.dataset.tog])));
    this.el.settingsBody.querySelectorAll('input[type=range]').forEach((r) => (r.value = s[r.dataset.key]));
    this.setHanded(s.handedness);
  }

  // ---------------------------------------------------------------- character
  _renderCharacter() {
    const p = this.store.profile;
    this.el.swatches.innerHTML = PALETTES.map((pal, i) => {
      const un = this.store.isUnlocked(`pal:${i}`);
      const c1 = `#${pal.shirt.toString(16).padStart(6, '0')}`, c2 = `#${pal.shorts.toString(16).padStart(6, '0')}`;
      return `<button class="swatch" data-pal="${i}" aria-pressed="${p.palette === i}" aria-label="${esc(pal.name)}${un ? '' : ' (locked)'}"><i style="background:linear-gradient(135deg,${c1} 52%,${c2} 52%)"></i>${un ? '' : '<span class="lock">🔒</span>'}</button>`;
    }).join('');
    this.el.chips.innerHTML = ACCESSORIES.map((a, i) => {
      const un = this.store.isUnlocked(`acc:${i}`);
      return `<button class="chip ${un ? '' : 'locked'}" data-acc="${i}" aria-pressed="${p.accessory === i}">${un ? '' : '🔒 '}${esc(a.name)}</button>`;
    }).join('');
  }

  _pickLook(kind, i) {
    const id = `${kind}:${i}`;
    if (!this.store.isUnlocked(id)) {
      this.el.hintline.textContent = `🔒 ${unlockHint(id)}`;
      return;
    }
    this.el.hintline.textContent = '';
    if (kind === 'pal') this.store.setLook(i, null);
    else this.store.setLook(null, i);
    this._renderCharacter();
    this.h.onLook?.(this.store.profile.palette, this.store.profile.accessory);
    this.h.onClick?.();
  }

  // ---------------------------------------------------------------- HUD
  setMode(practice) { this.el.mode.hidden = !practice; }

  hud(d) {
    const c = this.cache;
    const set = (key, el, text, prop = 'textContent') => {
      if (c[key] !== text) { c[key] = text; el[prop] = text; }
    };
    set('rank', this.el.rankNum, String(d.rank));
    set('of', this.el.rankOf, `/${d.total}`);
    set('time', this.el.time, formatTime(d.time));
    const pct = Math.round(d.progress * 100);
    set('pct', this.el.pct, `${pct}%`);
    if (c.prog !== pct) { c.prog = pct; this.el.progFill.style.width = `${Math.max(2, d.progress * 100)}%`; }
    set('speed', this.el.speed, String(Math.round(d.speed * 3.6)));
    if (d.board) {
      const html = d.board.map((r) => (r.gap ? '<div class="row"><b></b><span>···</span></div>' : `<div class="row ${r.me ? 'me' : ''}"><b>${r.rank}</b><span>${esc(r.name)}</span></div>`)).join('');
      set('board', this.el.board, html, 'innerHTML');
    }
  }

  toast(text, ms = 1400) {
    const t = this.el.toast;
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => t.classList.remove('show'), ms);
  }

  hint(text) {
    if (text == null) { this.el.hint.classList.remove('show'); return; }
    if (this.cache.hint !== text) { this.cache.hint = text; this.el.hint.textContent = text; }
    this.el.hint.classList.add('show');
  }

  tips(text) {
    const el = this.el.tips || (this.el.tips = this.root.querySelector('.hud-tips'));
    if (this.cache.tips === text) return;
    this.cache.tips = text;
    el.textContent = text || '';
    el.classList.toggle('show', !!text);
  }

  setJumpHint(on) {
    if (this.cache.jh !== on) { this.cache.jh = on; this.el.jump.classList.toggle('hint', on); }
  }

  setEdge(v) {
    const val = Math.max(0, Math.min(1, v));
    const r = Math.round(val * 20) / 20;
    if (this.cache.edge !== r) { this.cache.edge = r; this.el.vignette.style.opacity = String(r * 0.9); }
  }

  countdown(text) {
    const el = this.el.countdown;
    el.textContent = text;
    el.classList.remove('pop');
    void el.offsetWidth;
    if (text !== '') el.classList.add('pop');
  }

  // ---------------------------------------------------------------- end screen
  showEnd(d) {
    const e = this.el;
    e.endBadge.textContent = d.dnf ? 'Splash!' : ordinal(d.rank);
    e.endBadge.classList.toggle('dnf', !!d.dnf);
    e.endTitle.textContent = d.dnf
      ? (d.practice ? 'Practice run over' : 'You fell off the slide!')
      : d.rank === 1 ? 'You won the race! 🏆' : d.rank <= 3 ? 'Podium finish! 🎉' : `You finished ${ordinal(d.rank)} of ${d.total}`;
    e.endTime.textContent = d.dnf ? `Reached ${Math.round(d.progress * 100)}% of the course` : `Time ${formatTime(d.time)}`;
    e.endTime.style.fontSize = d.dnf ? '20px' : '';
    e.endBest.classList.toggle('new', !!d.newBest);
    e.endBest.textContent = d.newBest ? '★ New best time!' : d.best != null ? `Best ${formatTime(d.best)}` : '';
    e.endUnlock.hidden = !d.unlocked?.length;
    e.endUnlock.textContent = d.unlocked?.length ? `🔓 Unlocked: ${d.unlocked.map((u) => u.label).join(', ')}` : '';
    e.endAgain.textContent = d.dnf ? 'Try again' : 'Race again';
    this.updateEndList(d.list);
    this.show('end');
  }

  updateEndList(list) {
    const html = list.map((r) => {
      const t = r.status === 'finished' ? formatTime(r.time) : r.status === 'dnf' ? 'DNF' : '…';
      return `<div class="row ${r.isPlayer ? 'me' : ''}"><b>${r.rank}</b><span>${esc(r.name)}</span><i>${t}</i></div>`;
    }).join('');
    if (this.cache.endList !== html) { this.cache.endList = html; this.el.endList.innerHTML = html; }
  }
}
