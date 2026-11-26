#!/usr/bin/env python3
"""music-sample.py — render a short excerpt of the page's score to a WAV, for listening.

Usage:
  /opt/miniconda3/envs/claude-sandbox/bin/python -I tools/music-sample.py [out.wav]

Renders ~40 s of world/music.js's score with the same synthesis (kick, snare, swung hats, the
minor-soul pad turn, electric-piano plucks, a flute phrase) at 84 bpm. The arrangement is
scripted and seeded, so every run sounds the same — the browser's version is generative, this
one is its portrait.

The groove borrows the feel of the classic New York piano-soul beat (mid-tempo boom-bap, swung
sixteenths); the chords and every phrase are original.
"""
import sys
import wave

import numpy as np

SR = 44100
BPM = 74.0
BEAT = 60.0 / BPM
SW = 0.083                                   # swung sixteenths: off-beats land a hair late
GRID = [0.0, 0.25 + SW, 0.5, 0.75 + SW]      # swung sixteenth positions within a beat

PENTA = [0, 3, 5, 7, 10]                     # Bb minor pentatonic
CHORDS = [                                   # Bbm7, Gbmaj7, Dbmaj7, Abmaj7 — the minor-soul turn
    [46, 49, 53, 56], [42, 46, 49, 53], [37, 41, 44, 48], [32, 36, 39, 43],
]
SCALE = [46 + 12 * o + s for o in range(3) for s in PENTA]

N = int(SR * 46)
L = np.zeros((2, N), dtype=np.float64)
R = np.zeros((2, N), dtype=np.float64)       # work buffers, reused

rng = np.random.default_rng(7)


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def at(sec):
    return int(sec * SR)


def place(buf, x, t, pan=0.0, gain=1.0):
    """Add x (mono) into the stereo master at time t (float seconds)."""
    i0 = at(t)
    if i0 >= N:
        return
    n = min(len(x), N - i0)
    gl = gain * np.sqrt(0.5 * (1 - pan))
    gr = gain * np.sqrt(0.5 * (1 + pan))
    buf[0, i0:i0 + n] += x[:n] * gl
    buf[1, i0:i0 + n] += x[:n] * gr


def t_axis(dur):
    n = int(SR * dur)
    return np.arange(n) / SR, n


def noise_signal(n):
    return rng.uniform(-1.0, 1.0, n)


def spec_filt(x, kind, f, q=1.0):
    """Spectral filter: kind 'bp' (gaussian band), 'hp' or 'lp' (soft edges)."""
    X = np.fft.rfft(x)
    fr = np.fft.rfftfreq(len(x), 1.0 / SR)
    if kind == "bp":
        H = np.exp(-((fr - f) / (f / (2 * q) + 1e-9)) ** 2)
    elif kind == "hp":
        H = 1.0 / (1.0 + np.exp(-(fr - f) / (f * 0.12 + 1e-9)))
    else:
        H = 1.0 / (1.0 + np.exp((fr - f) / (f * 0.12 + 1e-9)))
    return np.fft.irfft(X * H, n=len(x))


def kick(vel=1.0):
    t, n = t_axis(0.32)
    f = 44 + 106 * np.exp(-t / 0.028)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * 0.8 * np.exp(-t / 0.09)
    click = noise_signal(n) * np.exp(-t / 0.004) * 0.22
    return (s + click) * vel


def snare(vel=1.0):
    t, n = t_axis(0.22)
    body = spec_filt(noise_signal(n), "bp", 1900, 0.7) * np.exp(-t / 0.05)
    tone = (np.sin(2 * np.pi * 190 * t) + 0.4 * np.sin(2 * np.pi * 380 * t)) * np.exp(-t / 0.045)
    return (body * 0.5 + tone * 0.3) * vel


def hat(open_=False, vel=1.0):
    t, n = t_axis(0.26 if open_ else 0.08)
    dur = 0.1 if open_ else 0.022
    return spec_filt(noise_signal(n), "hp", 6500) * np.exp(-t / dur) * (0.2 if open_ else 0.16) * vel


def pad_note(midi, dur=12.0, vel=0.008):
    t, n = t_axis(dur)
    out = np.zeros(n)
    for det in (-6, 6):
        f = hz(midi) * 2 ** (det / 1200)
        saw = 2 * ((f * t) % 1) - 1
        out += spec_filt(saw, "lp", 320)
    a = np.minimum(t / 3.0, 1.0) * np.minimum((dur - t) / 2.5, 1.0)
    return out * vel * np.clip(a, 0, 1)


def pluck(midi, dur=3.2, vel=0.1, bend=0.11):
    t, n = t_axis(dur)
    f = hz(midi)
    out = np.zeros(n)
    # the string is pressed into pitch: a slow scoop for the hook's long note
    ff = f * (1 + 0.018 * np.exp(-t / (bend / 3 + 1e-9)))
    for mul, amp in ((1, 1.0), (2, 0.22), (3.01, 0.14), (4.02, 0.03)):
        out += np.sin(2 * np.pi * np.cumsum(ff * mul) / SR) * amp
    out = spec_filt(out, "lp", 2600)
    return out * np.exp(-t / (dur * 0.3)) * vel


def stab(midi_notes, vel=0.045):
    t, n = t_axis(1.7)
    out = np.zeros(n)
    for m in midi_notes:
        for det in (-6, 6):
            f = hz(m) * 2 ** (det / 1200)
            saw = 2 * ((f * t) % 1) - 1
            out += spec_filt(saw, "lp", 420)
    return out * np.exp(-t / 0.45) * vel


def flute(midi, dur=1.0, vel=0.06):
    t, n = t_axis(dur + 0.4)
    f = hz(midi)
    vib = 5.0
    s = np.sin(2 * np.pi * f * t + 6 * np.sin(2 * np.pi * vib * t) / vib)
    breath = spec_filt(noise_signal(n), "bp", f * 2.1, 0.9) * 0.3
    a = np.clip(t / 0.18, 0, 1) * np.clip((dur + 0.35 - t) / 0.3, 0, 1)
    return (s + breath) * vel * np.clip(a, 0, 1)


def bar_time(bar, beat, sub=0.0):
    return (bar * 4 + beat) * BEAT + (GRID[sub] if sub < 4 else 0.0) * BEAT


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "/tmp/paper-nyc-sample.wav"

    # ---- drums: 14 bars ------------------------------------------------------------
    for bar in range(14):
        t0 = bar * 4 * BEAT
        ev = []
        ev.append((0.0, "kick", 1.0))
        ev.append((2.333, "kick", 0.9))
        if bar % 4 == 3:
            ev.append((3.833, "kick", 0.7))
        if bar % 8 == 6:
            ev.append((2.833, "kick", 0.6))
        ev.append((1.0, "snare", 1.0))
        ev.append((3.0, "snare", 0.95))
        if bar % 3 == 1:
            ev.append((1.833, "snare", 0.26))
        for b in range(4):
            for i, g in enumerate(GRID):
                p = b + g
                if bar % 2 == 1 and i == 3 and b == 3:
                    ev.append((p, "hat-open", 1.0))
                    continue
                ev.append((p, "hat", 1.0 if i % 2 == 0 else 0.7))
        for p, v, vel in ev:
            if v == "kick":
                place(L, kick(vel), t0 + p * BEAT)
            elif v == "snare":
                place(L, snare(vel), t0 + p * BEAT)
            else:
                place(L, hat(open_=(v == "hat-open"), vel=vel), t0 + p * BEAT, pan=0.15)

    # ---- harmony: the pad turn under everything, from bar 3, with the outro fade -------------
    for bar in range(3, 12):
        chord = CHORDS[bar % 4]
        for k, m in enumerate(chord):
            place(L, pad_note(m, 13.0, 0.007), bar * 4 * BEAT, pan=-0.25 + 0.17 * k)
    for bar in (12, 13):
        chord = CHORDS[bar % 4]
        for k, m in enumerate(chord):
            place(L, pad_note(m, 6.0, 0.006), bar * 4 * BEAT, pan=-0.25 + 0.17 * k)

    # ---- the chorus line: the long scooped note and the flowing response ----------------------
    def hook(t0, chord):
        place(L, pluck(56, 1.6, 0.05, 0.1), t0 - 0.167 * BEAT, pan=-0.15)      # the pickup ("In")
        place(L, stab(chord, 0.05), t0)                                        # the piano chord
        place(L, pluck(58, 3.0, 0.115, 0.5), t0, pan=-0.1)                     # "New Yo-o-ork"
        place(L, pluck(56, 1.8, 0.065, 0.12), t0 + 4 * BEAT, pan=-0.1)
        seq = [(1, 49), (1.5, 51), (2, 53), (2.333, 54), (2.5, 56), (3, 53), (3.5, 56)]
        for b, m in seq:
            place(L, pluck(m, 1.7, 0.055, 0.09), t0 + 4 * BEAT + b * BEAT, pan=-0.05 + (b - 2.5) * 0.08)
        place(L, pluck(58, 2.6, 0.095, 0.15), t0 + 8 * BEAT, pan=-0.05)        # "…made of"

    for bar in (3, 7, 11):
        hook(bar * 4 * BEAT, CHORDS[bar % 4])

    # ---- the verses between the choruses: sparse notes on the swung grid ----------------------
    for bar, beats, steps in ((5, [1.5, 3.333], [8, 5]), (6, [1.0, 2.833], [6, 10]),
                              (9, [1.333, 3.0], [5, 9]), (10, [1.833, 3.333], [4, 7])):
        for b, s in zip(beats, steps):
            place(L, pluck(SCALE[s], 3.4, 0.07), bar * 4 * BEAT + b * BEAT, pan=0.2)

    # ---- the flute, one phrase in the middle -------------------------------------------
    for b, s, d in ((1.5, 10, 1.0), (2.833, 8, 0.7), (3.833, 6, 1.3)):
        place(L, flute(SCALE[s], d, 0.05), 9 * 4 * BEAT + b * BEAT, pan=0.3)

    # ---- master: soft clip, fade in/out ------------------------------------------------
    L[:] = np.tanh(L * 1.15) * 0.85
    fade = int(SR * 0.4)
    L[:, :fade] *= np.linspace(0, 1, fade)
    L[:, -int(SR * 2.5):] *= np.linspace(1, 0, int(SR * 2.5))
    data = (L.T * 32767).astype(np.int16)

    with wave.open(out, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())
    print(f"wrote {out} ({N / SR:.0f} s)")


if __name__ == "__main__":
    main()
