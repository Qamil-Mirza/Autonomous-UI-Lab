"""Original score for GhostLoop promo v5 (30 s): warm, playful pulse in D major with a ghostly minor bed for the night
swarm, and sound design synced to the picture (drop, gulp, pops, bonks, clicks, chimes). Deterministic; numpy only.
Writes output/soundtrack-v5.wav (48 kHz stereo)."""
import math, wave
from pathlib import Path
import numpy as np

RATE, DUR = 48000, 30.0
N = int(RATE * DUR)
L = np.zeros(N); R = np.zeros(N)
rng = np.random.default_rng(5)
BPM = 112; BEAT = 60 / BPM; BAR = 4 * BEAT

def midi(n): return 440 * 2 ** ((n - 69) / 12)
def add(at, sig, pan=0.0):
    i = int(at * RATE)
    if i >= N or i < 0: return
    sig = sig[: N - i]
    L[i:i + len(sig)] += sig * math.sqrt((1 - pan) / 2); R[i:i + len(sig)] += sig * math.sqrt((1 + pan) / 2)
def tt(d): return np.arange(int(d * RATE)) / RATE
def adsr(t, a, d, s, r, hold):
    e = np.minimum(1, t / max(a, 1e-4)); e = np.where(t < a + d, 1 - (1 - s) * np.clip((t - a) / max(d, 1e-4), 0, 1), s) * e
    return e * (1 - np.clip((t - hold) / max(r, 1e-4), 0, 1))
def lowpass(x, a):
    y = np.zeros_like(x); v = 0.0
    for i in range(len(x)): v += a * (x[i] - v); y[i] = v
    return y

def pluck(at, note, d=.4, g=.12, pan=0, bright=1.):
    t = tt(d + .5); f = midi(note)
    s = np.sin(2 * np.pi * f * t) + .4 * bright * np.sin(4 * np.pi * f * t) * np.exp(-t * 7) + .15 * bright * np.sin(6 * np.pi * f * t) * np.exp(-t * 11)
    add(at, s * adsr(t, .003, .2, .3, .35, d) * np.exp(-t * 1.8) * g, pan)
def pad(at, notes, d, g=.06, pan=0, a=.8):
    t = tt(d + 1.4); s = np.zeros(len(t))
    for k, n in enumerate(notes):
        f = midi(n); s += np.sin(2 * np.pi * f * t + k) + .5 * np.sin(2 * np.pi * f * 1.005 * t) + .2 * np.sin(4 * np.pi * f * t)
    add(at, s / (1.7 * len(notes)) * adsr(t, a, .4, .85, 1.3, d) * (.85 + .15 * np.sin(2 * np.pi * .4 * t)) * g, pan)
def kick(at, g=.3):
    t = tt(.3); f = 50 + 120 * np.exp(-t * 30)
    add(at, np.sin(2 * np.pi * np.cumsum(f) / RATE) * np.exp(-t * 12) * g)
def bass(at, note, d, g=.16):
    t = tt(d + .15); f = midi(note)
    add(at, (np.sin(2 * np.pi * f * t) + .3 * np.sin(4 * np.pi * f * t) * np.exp(-t * 6)) * adsr(t, .008, .15, .6, .12, d) * g)
def hat(at, g=.035, pan=.3):
    t = tt(.05); add(at, rng.standard_normal(len(t)) * np.exp(-t * 110) * g, pan)
def click(at, g=.14):
    t = tt(.06); add(at, (np.sin(2 * np.pi * 2100 * t) * np.exp(-t * 140) + .5 * rng.standard_normal(len(t)) * np.exp(-t * 400)) * g)
def pop(at, note=84, g=.12, pan=0):
    t = tt(.18); f = midi(note) * (1 + 1.2 * np.exp(-t * 40))
    add(at, np.sin(2 * np.pi * np.cumsum(f) / RATE) * np.exp(-t * 22) * g, pan)
def boing(at, note=72, g=.12, pan=0, up=True):
    t = tt(.45); f = midi(note) * (1 + (.6 if up else -.35) * (1 - np.exp(-t * 9))) * (1 + .03 * np.sin(2 * np.pi * 14 * t))
    add(at, np.sin(2 * np.pi * np.cumsum(f) / RATE) * np.exp(-t * 6) * g, pan)
def bonk(at, g=.22):
    t = tt(.35); f = 180 * (1 - .45 * (1 - np.exp(-t * 18)))
    add(at, (np.sin(2 * np.pi * np.cumsum(f) / RATE) + .3 * rng.standard_normal(len(t)) * np.exp(-t * 60)) * np.exp(-t * 11) * g)
def whoosh(at, d, g=.06, pan=0, rise=True):
    # Soft air: two-pole low-pass noise kept under ~700 Hz (no hiss), raised-cosine envelope, normalized and quiet,
    # with a gentle stereo drift instead of a hard pan.
    t = tt(d); n = rng.standard_normal(len(t))
    a = np.linspace(.012, .07, len(t)) if rise else np.linspace(.07, .012, len(t))
    y = np.zeros(len(t)); v1 = v2 = 0.
    for i in range(len(t)): v1 += a[i] * (n[i] - v1); v2 += a[i] * (v1 - v2); y[i] = v2
    y /= max(1e-9, np.sqrt(np.mean(y ** 2)))
    env = np.sin(np.pi * t / d) ** 2.2
    s = y * env * g * .5
    drift = np.linspace(-pan, pan, len(t)) if pan else np.zeros(len(t))
    i0 = int(at * RATE)
    if i0 >= N: return
    s, drift = s[: N - i0], drift[: N - i0]
    L[i0:i0 + len(s)] += s * np.sqrt((1 - drift) / 2); R[i0:i0 + len(s)] += s * np.sqrt((1 + drift) / 2)
def chime(at, notes, g=.1, gap=.07):
    for k, n in enumerate(notes): pluck(at + k * gap, n, .8, g, pan=(k - len(notes) / 2) * .2, bright=.7)
def ghost(at, d, note, g=.05, pan=0):
    t = tt(d); vib = .015 * np.sin(2 * np.pi * 5.5 * t) * np.minimum(1, t / .3)
    f = midi(note) * (1 + vib) * (1 - .06 * np.exp(-t * 4))
    add(at, (np.sin(2 * np.pi * np.cumsum(f) / RATE) + .15 * np.sin(4 * np.pi * np.cumsum(f) / RATE)) * np.sin(np.pi * t / d) ** 1.3 * g, pan)
def thud(at, g=.3):
    kick(at, g); t = tt(.25); add(at, lowpass(rng.standard_normal(len(t)), .08) * np.exp(-t * 18) * g * 1.5)

D, Fs, A, B, G, E, Cs = 62, 66, 69, 71, 67, 64, 73
PROG = [(D, [D, Fs, A]), (B - 12, [B - 12, D, Fs]), (G - 12, [G - 12, B - 12, D]), (A - 12, [A - 12, Cs, E])]
MOTIF = [74, 78, 81, 78, 83, 81, 78, 76]

# ---- 0–5.6: drop and build, light and bright ----
pad(0, [D - 12, A - 12, D, Fs], 5.6, g=.045, a=1.2)
pop(.08, 79, .08)
whoosh(.85, .85, .05, pan=.4)
thud(1.68, .3); boing(1.72, 60, .07, up=False)
pop(2.02, 86, .07); ghost(2.12, .6, 81, .03)
chime(2.74, [86, 90, 93], .1)
for k in range(4): pluck(.3 + k * BEAT * 2, [74, 81, 78, 83][k], .6, .07, pan=(-.3, .3, -.2, .2)[k])
whoosh(3.0, .9, .05)
for k in range(4): pop(3.62 + k * .07, 70 + k * 2, .045, pan=(k - 1.5) * .3)
for k, n in enumerate([74, 78, 81, 83, 86, 90]): pop(4.15 + k * .09, n, .07, pan=(k - 2.5) * .25)
pop(4.75, 93, .08); pop(4.85, 95, .08)
for k in range(6): hat(3.2 + k * BEAT, .02)

# ---- 5.65–12.3: the night swarm, a ghostly minor bed that builds ----
whoosh(5.5, .9, .07, rise=True); kick(6.4, .26)
pad(5.7, [D - 12, A - 12, D, 65, A], 6.8, g=.07, a=.6)
for k, at in enumerate([6.5, 6.64, 6.78]): boing(at, [67, 71, 74][k], .12, pan=(k - 1) * .5)
for k in range(9): pop(7.45 + k * .085, 88 + (k % 4) * 2, .05, pan=math.sin(k * 1.7) * .7)
ghost(7.4, 1.6, 77, .04, -.3); ghost(8.1, 1.4, 81, .035, .3)
t = 8.5; k = 0
while t < 12.2:
    kick(t, .24 if k % 2 == 0 else .14); bass(t, 50, BEAT * .85, .13); hat(t + BEAT / 2, .03)
    pluck(t, [74, 77, 81, 77][k % 4], BEAT * .4, .06, pan=math.sin(k) * .5, bright=.6)
    t += BEAT; k += 1
whoosh(9.0, 2.0, .05); ghost(9.2, 2.6, 74, .04, .2)
for k in range(12): pop(10.95 + ((k * 5) % 12) * .075 + .55, 96 - (k % 5), .04, pan=math.sin(k) * .8)
whoosh(10.8, 1.2, .08, rise=True)
thud(11.92, .34); chime(11.95, [86, 93, 98], .08, .05)

# ---- 12.3–24.5: friction, approve, retest over the D-major groove ----
whoosh(12.3, .7, .05, rise=False)
t, bar = 12.85, 0
while t < 24.45:
    root, chord = PROG[bar % 4]
    pad(t, chord, BAR, g=.05)
    for b in range(4):
        bt = t + b * BEAT
        if bt >= 24.45: break
        kick(bt, .22 if b % 2 == 0 else .12); bass(bt, root - 12, BEAT * .8, .13); hat(bt + BEAT / 2, .028)
        for e in range(2):
            idx = (b * 2 + e) % 8
            pluck(bt + e * BEAT / 2, MOTIF[idx], BEAT * .38, .055, pan=math.sin(idx) * .4, bright=.7)
    t += BAR; bar += 1
for at in (13.85, 15.05, 16.65): whoosh(at, .55, .06, pan=.3)
bonk(14.06, .26); pop(14.15, 70, .09); boing(14.4, 64, .06, up=False)
bonk(15.4, .14); pop(15.55, 73, .08); ghost(15.4, .6, 70, .03)
pop(16.35, 76, .08)
whoosh(17.3, .8, .05, pan=.3)
whoosh(18.0, .75, .045, pan=.4)
pop(18.62, 81, .06, .5); pop(18.72, 83, .06, .5)
click(19.84, .16); chime(19.92, [74, 78, 81, 86], .1, .06)
pop(20.05, 90, .06, .5); pop(20.15, 93, .06, .5)
whoosh(20.55, .75, .06, pan=-.3)
pop(21.3, 74, .1); boing(21.32, 69, .06)
for k, at in enumerate([22.25, 22.55, 22.85]): kick(at, .18); pop(at, 81 + k * 3, .08, pan=(k - 1) * .4)
chime(23.1, [74, 78, 81, 86, 90], .11, .06)
for k in range(4): pop(23.8 + k * .16, 95 - k * 2, .045)

# ---- 24.5–30: collapse into the loop, wordmark, end ----
whoosh(24.5, .55, .06, rise=False)
whoosh(24.9, .95, .07, rise=True); pad(24.9, [D, Fs, A, D + 12], 1.0, g=.05, a=.5)
thud(25.85, .3); boing(25.87, 74, .1)
for k in range(6): pop(25.98 + k * .04, 76 + k, .045, pan=(k - 3) * .15)
for k in range(10): pluck(25.95 + k * .15, [74, 78, 81, 86, 81, 78, 74, 78, 81, 86][k], .3, .07, pan=math.sin(k * 1.3) * .6)
ghost(26.0, 1.5, 86, .025, .4)
boing(27.28, 67, .1)
kick(27.6, .3)
pad(27.6, [D - 12, A - 12, D, Fs, A, D + 12], 2.4, g=.1, a=.15)
chime(27.62, [74, 78, 81, 86], .12, .08); pluck(28.3, 93, 1.4, .06, .3)

mix = np.stack([L, R])
mix = np.tanh(mix * 1.5) / 1.5
tail = int(1.6 * RATE); mix[:, -tail:] *= np.linspace(1, 0, tail) ** 1.5
mix *= .9 / max(1e-9, np.abs(mix).max())
out = Path(__file__).parent / 'output' / 'soundtrack-v5.wav'; out.parent.mkdir(exist_ok=True)
with wave.open(str(out), 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(RATE); w.writeframes((np.clip(mix.T, -1, 1) * 32767).astype('<i2').tobytes())
print(f'Wrote {out} ({DUR}s, {RATE} Hz stereo)')
