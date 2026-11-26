// world/music.js — a slow, generative score for the park.
//
// The manner is the calm of a certain block game's soundtrack: sparse notes, long silences, a pad
// breathing underneath, nothing that hurries you. The flavour is this park's — and its city's: a
// mid-tempo boom-bap groove (84 bpm, swung sixteenths) in the manner of the classic New York
// piano-soul beat, electric-piano plucks and a breathy flute over a minor-soul four-chord turn
// (Bbm7 - Gbmaj7 - Dbmaj7 - Abmaj7): the feel of "Empire State of Mind" without a note of its
// melody. The chords and phrases here are original; the groove is the city's. Every note is
// synthesised here — no samples, no files — so the score never repeats and never weighs anything.
//
// It starts on the first gesture (browsers will not start audio before one) and shares the paper
// foley's AudioContext, so the page runs one audio graph, not two. M mutes / unmutes it.
//
// The scheduler looks a fraction of a second ahead on the audio clock (setInterval is only the
// nudge), so notes land sample-accurately even when the frame rate stumbles.

const LOOKAHEAD = 0.8;          // seconds of notes kept scheduled on the audio clock
const PENTA = [0, 3, 5, 7, 10]; // Bb minor pentatonic: Bb Db Eb F Ab
const SCALE = [];               // three octaves of it, Bb2 upward
for (let o = 0; o < 3; o++) for (const s of PENTA) SCALE.push(46 + 12 * o + s);
const CHORDS = [                // the minor-soul turn, one bar each: Bbm7, Gbmaj7, Dbmaj7, Abmaj7
  [46, 49, 53, 56], [42, 46, 49, 53], [37, 41, 44, 48], [32, 36, 39, 43],
];
const BPM = 74;                 // the groove: unhurried, like a walk across the park
const BEAT = 60 / BPM;
const SWING = 0.083;            // swung sixteenths: the off-beats land a hair late
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[(Math.random() * a.length) | 0];

export function createMusic(H) {
  let ctx = null, master = null, dry = null, wet = null, conv = null, analyser = null;
  let timer = null, on = true, noteCount = 0;
  let nextNote = 0, nextChord = 0, chordAt = 0, idx = 4;
  let noiseBuf = null;

  try { on = localStorage.getItem('papernyc.music') !== 'off'; } catch { /* private window: play it */ }

  // ---- graph -----------------------------------------------------------------------------------
  function noise() {
    if (!noiseBuf) {
      const n = Math.floor(ctx.sampleRate * 2);
      noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    }
    return noiseBuf;
  }

  // a dark, smooth tail rather than a hall: the page is small and close
  function impulse(seconds = 3.4) {
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / n;
        lp += (Math.random() * 2 - 1 - lp) * 0.32;
        d[i] = lp * Math.pow(1 - t, 2.6);
      }
    }
    return buf;
  }

  function build() {
    master = ctx.createGain();
    master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -24; comp.knee.value = 18; comp.ratio.value = 3;
    comp.attack.value = 0.02; comp.release.value = 0.4;
    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    master.connect(comp); comp.connect(analyser); analyser.connect(ctx.destination);

    dry = ctx.createGain(); dry.gain.value = 0.75; dry.connect(master);
    conv = ctx.createConvolver(); conv.buffer = impulse();
    wet = ctx.createGain(); wet.gain.value = 0.5; wet.connect(conv); conv.connect(master);

    nextChord = ctx.currentTime + 0.6;
    nextNote = ctx.currentTime + 2.0;
    nextDrum = ctx.currentTime + 0.5;
    drumBar = 0;
    chordAt = 0;
  }

  function voice(pan = 0) {
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    p.connect(dry); p.connect(wet);
    return p;
  }

  // ---- voices ----------------------------------------------------------------------------------
  // an electric-piano pluck: a soft fundamental, a bell overtone a fifth up, a long dark tail.
  // bend: how slowly the string is pressed into pitch (s): 0.11 for most notes, ~0.5 for the
  // hook's long held note — the slow soulful scoop of a sung "New Yo-o-ork".
  function pluck(t, midi, vel, pan, len = rand(2.6, 4.6), bend = 0.11) {
    const f = hz(midi);
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(vel, t + 0.006);
    out.gain.exponentialRampToValueAtTime(0.0001, t + len);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(4200, t);
    lp.frequency.exponentialRampToValueAtTime(680, t + len * 0.85);
    lp.Q.value = 0.3;
    lp.connect(out); out.connect(voice(pan));
    for (const [mul, type, amp] of [[1, 'sine', 1], [2, 'sine', 0.22], [3.01, 'sine', 0.16], [4.02, 'triangle', 0.03]]) {
      const o = ctx.createOscillator();
      o.type = type; o.frequency.value = f * mul;
      if (mul === 1) {                                  // the string is pressed into pitch
        o.frequency.setValueAtTime(f * 1.018, t);
        o.frequency.exponentialRampToValueAtTime(f, t + bend);
      }
      const g = ctx.createGain(); g.gain.value = amp;
      o.connect(g); g.connect(lp);
      o.start(t); o.stop(t + len + 0.1);
    }
    noteCount++;
  }

  // a breathy flute: a sine with a breath of filtered noise, a slow vibrato, a small slide into the note
  function flute(t, midi, dur, vel, pan) {
    const f = hz(midi);
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(vel, t + 0.18);
    out.gain.setValueAtTime(vel, t + dur - 0.2);
    out.gain.linearRampToValueAtTime(0, t + dur + 0.35);
    const panN = voice(pan);
    out.connect(panN);

    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(f * 0.982, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.14);
    const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = f * 2;
    const g2 = ctx.createGain(); g2.gain.value = 0.03;
    const vib = ctx.createOscillator(); vib.frequency.value = rand(4.6, 5.6);
    const vibG = ctx.createGain(); vibG.gain.value = 6;          // cents
    vib.connect(vibG); vibG.connect(o.detune); vibG.connect(o2.detune);
    o.connect(out); o2.connect(g2); g2.connect(out);
    o.start(t); o2.start(t); vib.start(t);
    o.stop(t + dur + 0.5); o2.stop(t + dur + 0.5); vib.stop(t + dur + 0.5);

    const ns = ctx.createBufferSource(); ns.buffer = noise(); ns.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * 2.1; bp.Q.value = 0.9;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(vel * 0.32, t + 0.16);
    ng.gain.setValueAtTime(vel * 0.32, t + dur - 0.2);
    ng.gain.linearRampToValueAtTime(0, t + dur + 0.3);
    ns.connect(bp); bp.connect(ng); ng.connect(panN);
    ns.start(t); ns.stop(t + dur + 0.4);
    noteCount++;
  }

  function pad(t, notes) {
    const len = rand(11, 14);              // one chord each bar; a long overlap keeps the air
    for (const m of notes) {
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth'; o.frequency.value = hz(m); o.detune.value = det + rand(-3, 3);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = rand(260, 400); lp.Q.value = 0.35;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.008, t + rand(2.5, 4));
        g.gain.setValueAtTime(0.008, t + len - 3);
        g.gain.linearRampToValueAtTime(0, t + len);
        o.connect(lp); lp.connect(g); g.connect(voice(rand(-0.3, 0.3)));
        o.start(t); o.stop(t + len + 0.1);
      }
    }
  }

  // ---- the hook phrase --------------------------------------------------------------------------
  // The chorus line, two bars long, in the rhythm of the city's own: a syncopated pickup, the long
  // held note scooped into pitch over a piano chord stab (the "In New Yo-o-ork" moment), then the
  // flowing response — seven quick notes tumbling down the swung grid to land on a held note, the
  // shape of "concrete jungle where dreams are made of". The notes are this score's own, and the
  // phrase arrives like any other, from the top of a bar.
  function stab(t, notes, vel = 0.05) {
    for (const m of notes) {
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth'; o.frequency.value = hz(m); o.detune.value = det + rand(-2, 2);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 0.3;
        const g = ctx.createGain();
        g.gain.setValueAtTime(vel, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 1.5);
        o.connect(lp); lp.connect(g); g.connect(voice(rand(-0.15, 0.15)));
        o.start(t); o.stop(t + 1.6);
      }
    }
    noteCount++;
  }

  function scheduleHook(t0) {
    // the pickup, on the swung off-beat before the bar ("In")
    pluck(t0 - 0.167 * BEAT, 56, 0.05, -0.15, 1.6, 0.1);
    // the long held note, scooped in slowly, under the chord stab ("New Yo-o-ork")
    stab(t0, CHORDS[chordAt], 0.05);
    pluck(t0, 58, 0.115, -0.1, 3.0, 0.5);
    pluck(t0 + 4 * BEAT, 56, 0.07, -0.1, 1.8, 0.12);
    // the flowing response: quick syncopated notes tumbling to a held landing
    const bar = t0 + 4 * BEAT;
    const seq = [[1, 49, 0.06], [1.5, 51, 0.055], [2, 53, 0.06], [2.333, 54, 0.05],
                 [2.5, 56, 0.06], [3, 53, 0.055], [3.5, 56, 0.05]];
    for (const [b, m, v] of seq) pluck(bar + b * BEAT, m, v, -0.05 + (b - 2.5) * 0.08, 1.7, 0.09);
    pluck(bar + 4 * BEAT, 58, 0.095, -0.05, 2.6, 0.15);   // "…made of" — the held landing
  }

  // ---- the groove -------------------------------------------------------------------------------
  // boom-bap at 74: a soft 808-style kick, a paper snare, swung sixteenth hats. Original pattern,
  // the city's feel. Bars are seeded so the variations replay the same on every restart.
  function kick(t, vel = 1) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.09);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.8 * vel, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
    o.connect(g); g.connect(dry);
    o.start(t); o.stop(t + 0.3);
    const c = ctx.createBufferSource(); c.buffer = noise();
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2400;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.2 * vel, t);
    cg.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
    c.connect(hp); hp.connect(cg); cg.connect(dry);
    c.start(t); c.stop(t + 0.03);
    noteCount++;
  }

  function snare(t, vel = 1) {
    const ns = ctx.createBufferSource(); ns.buffer = noise();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 0.7;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.45 * vel, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    ns.connect(bp); bp.connect(ng); ng.connect(dry);
    ns.start(t); ns.stop(t + 0.2);
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 190;
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.28 * vel, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    o.connect(og); og.connect(dry);
    o.start(t); o.stop(t + 0.09);
    noteCount++;
  }

  function hat(t, open = false) {
    const ns = ctx.createBufferSource(); ns.buffer = noise();
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6500;
    const ng = ctx.createGain();
    const dur = open ? 0.2 : 0.04;
    ng.gain.setValueAtTime(open ? 0.2 : 0.14, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + dur);
    ns.connect(hp); hp.connect(ng); ng.connect(dry);
    ns.start(t); ns.stop(t + dur + 0.02);
  }

  // one bar of the groove: [t, voice, vel] on the swung sixteenth grid (t in beats 0..4)
  function barPattern(bar) {
    const r = Math.random;
    const ev = [];
    // kick: one, the swung "a" of two, and a pickup into the next bar now and then
    ev.push([0, 'kick', 1]);
    ev.push([2.333, 'kick', 0.9]);
    if (bar % 4 === 3) ev.push([3.833, 'kick', 0.7]);
    if (bar % 8 === 6) ev.push([2.833, 'kick', 0.6]);
    // snare on two and four, a ghost on the swung "a" of one sometimes
    ev.push([1, 'snare', 1]);
    ev.push([3, 'snare', 0.95]);
    if (r() < 0.35) ev.push([1.833, 'snare', 0.28]);
    // swung sixteenth hats, the on-beats a touch louder; an open hat closes the phrase
    const H = [0, 0.333, 0.5, 0.833];
    for (let b = 0; b < 4; b++) {
      for (let i = 0; i < 4; i++) {
        const p = b + H[i];
        if (bar % 2 === 1 && p >= 3.833) { ev.push([3.833, 'hat-open', 1]); break; }
        ev.push([p, 'hat', i % 2 === 0 ? 1 : 0.7]);
      }
    }
    return ev;
  }

  let nextDrum = 0, drumBar = 0;
  function drumTick(now, ahead) {
    while (nextDrum < now + ahead) {
      const pat = barPattern(drumBar);
      for (const [b, voiceName, vel] of pat) {
        const t = nextDrum + b * BEAT;
        if (voiceName === 'kick') kick(t, vel);
        else if (voiceName === 'snare') snare(t, vel);
        else hat(t, voiceName === 'hat-open');
      }
      nextDrum += 4 * BEAT;
      drumBar++;
    }
  }

  // ---- the score -------------------------------------------------------------------------------
  function nextIdx() {
    const step = Math.random() < 0.72 ? (Math.random() < 0.5 ? -1 : 1) : (Math.random() < 0.5 ? -2 : 2);
    idx = Math.max(0, Math.min(SCALE.length - 1, idx + step));
    if (Math.random() < 0.06) idx = pick([2, 4, 5, 7]);
    return idx;
  }

  // snap a time onto the swung sixteenth grid (the notes sit in the groove, not beside it)
  function snap(t) {
    const pos = (t % BEAT) / BEAT;
    let best = 0, bestD = Infinity;
    for (const g of [0, 0.333, 0.5, 0.833, 1]) {
      const d = Math.abs(g - pos);
      if (d < bestD) { bestD = d; best = g; }
    }
    return t - (pos - best) * BEAT;
  }

  function event(t) {
    const r = Math.random();
    if (r < 0.5) {                                   // one note, now and then a grace note or a fifth
      const i = nextIdx();
      const vel = rand(0.06, 0.11);
      const pan = rand(-0.35, 0.35);
      const tt = Math.random() < 0.4 ? snap(t) : t;  // most notes ride the swung grid
      if (Math.random() < 0.2 && i > 0) pluck(tt - 0.09, SCALE[i - 1], vel * 0.4, pan - 0.1, rand(1.4, 2.2));
      pluck(tt, SCALE[i], vel, pan);
      if (Math.random() < 0.15) pluck(tt + 0.02, SCALE[Math.min(i + 4, SCALE.length - 1)], vel * 0.45, pan + 0.15, rand(2, 3));
      return rand(2.4, 7.0);                          // more space: the drums carry the pulse
    }
    if (r < 0.62) {                                  // a rising arpeggio, the piano's little gesture
      const i = Math.max(0, Math.min(SCALE.length - 5, nextIdx() - 1));
      const n = 3 + ((Math.random() * 3) | 0);
      for (let k = 0; k < n; k++) pluck(t + k * 0.12, SCALE[i + k], rand(0.04, 0.08), rand(-0.3, 0.3), rand(2.4, 3.8));
      return rand(6, 10);
    }
    if (r < 0.72) {                                  // the chorus line, from the top of the next bar
      const bar = Math.ceil((t + 0.01) / (4 * BEAT)) * (4 * BEAT);
      scheduleHook(bar);
      return bar + 9 * BEAT - t;                     // two bars of room for the phrase
    }
    if (r < 0.85) {                                  // a flute phrase
      const n = 3 + ((Math.random() * 3) | 0);
      const i0 = Math.max(0, Math.min(SCALE.length - 6, nextIdx() - 1));
      let tt = t;
      for (let k = 0; k < n; k++) {
        const d = rand(0.5, 1.15);
        flute(tt, SCALE[Math.max(0, Math.min(SCALE.length - 1, i0 + ((Math.random() * 3) | 0) - 1))], d, rand(0.04, 0.065), rand(-0.3, 0.3));
        tt += d + rand(0.04, 0.16);
      }
      return tt - t + rand(7, 11);
    }
    return rand(3, 8);                               // silence: the park between phrases
  }

  function tick() {
    if (!ctx || !on) return;
    const now = ctx.currentTime;
    drumTick(now, LOOKAHEAD);
    while (nextChord < now + LOOKAHEAD) {
      pad(nextChord, CHORDS[chordAt]);
      chordAt = (chordAt + 1) % CHORDS.length;
      nextChord += 4 * BEAT;                 // one chord per bar, the groove's own time
    }
    while (nextNote < now + LOOKAHEAD) {
      nextNote += event(nextNote);
    }
  }

  // ---- start / mute ----------------------------------------------------------------------------
  function start() {
    if (ctx) return;
    try {
      const sfx = H.sound;
      ctx = sfx ? (sfx.unlock() || sfx.ctx) : new (window.AudioContext || window.webkitAudioContext)();
    } catch { return; }
    if (!ctx) return;
    build();
    if (on) {
      master.gain.setValueAtTime(0, ctx.currentTime);
      master.gain.linearRampToValueAtTime(0.75, ctx.currentTime + 3.5);
      timer = setInterval(tick, 200);
      tick();
    }
  }

  function toggle() {
    on = !on;
    try { localStorage.setItem('papernyc.music', on ? 'on' : 'off'); } catch { /* ignore */ }
    if (on && !ctx) { start(); return on; }
    if (!ctx) return on;
    if (on) {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(0.75, ctx.currentTime, 0.4);
      if (!timer) { nextNote = Math.max(nextNote, ctx.currentTime + 1.2); nextChord = Math.max(nextChord, ctx.currentTime + 0.8); timer = setInterval(tick, 200); tick(); }
    } else {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(0, ctx.currentTime, 0.25);
      if (timer) { clearInterval(timer); timer = null; }
    }
    return on;
  }

  // a gesture is what lets the page sing; the intro card's Begin button counts
  addEventListener('pointerdown', start, { once: true });
  addEventListener('keydown', start, { once: true });
  addEventListener('keydown', (e) => {
    if (e.key === 'm' || e.key === 'M') { if (!e.metaKey && !e.ctrlKey && !e.altKey) toggle(); }
  });

  const api = {
    get started() { return !!ctx; },
    get state() { return ctx ? ctx.state : 'none'; },
    get enabled() { return on; },
    get notes() { return noteCount; },
    get level() {                                   // RMS of the last block, for QA
      if (!analyser) return 0;
      const d = new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(d);
      let s = 0;
      for (let i = 0; i < d.length; i++) { const v = (d[i] - 128) / 128; s += v * v; }
      return Math.sqrt(s / d.length);
    },
    start, toggle,
  };
  H.music = api;
  if (window.__papercraft) window.__papercraft.music = api;
  return api;
}
