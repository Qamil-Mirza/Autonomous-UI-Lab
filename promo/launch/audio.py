"""Original score for the GhostLoop launch film: warm synth pulse at 104 BPM, plucked motif, swells at the
reveal and the result, soft ticks on captions and clicks. Deterministic; writes output/score.wav (48 kHz stereo)."""
import math, wave, struct
from pathlib import Path
import numpy as np

RATE, DURATION = 48000, 71.0
N = int(RATE * DURATION)
L = np.zeros(N); R = np.zeros(N)
BPM = 104; BEAT = 60 / BPM; BAR = BEAT * 4
rng = np.random.default_rng(7)

def midi(n): return 440 * 2 ** ((n - 69) / 12)

def add(start, sig, pan=0.0):
    i = int(start * RATE)
    if i >= N: return
    sig = sig[: N - i]
    L[i:i + len(sig)] += sig * math.sqrt((1 - pan) / 2)
    R[i:i + len(sig)] += sig * math.sqrt((1 + pan) / 2)

def env(n, a, d, s, r, hold):
    t = np.arange(n) / RATE
    e = np.minimum(1, t / max(a, 1e-4))
    e *= np.where(t < a + d, 1 - (1 - s) * np.clip((t - a) / max(d, 1e-4), 0, 1), s)
    rel = np.clip((t - hold) / max(r, 1e-4), 0, 1)
    return e * (1 - rel)

def pluck(start, note, dur=.5, gain=.16, pan=0.0, bright=1.0):
    n = int((dur + .4) * RATE); t = np.arange(n) / RATE; f = midi(note)
    sig = np.sin(2 * np.pi * f * t) + .35 * bright * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t * 6) + .12 * np.sin(2 * np.pi * 3 * f * t) * np.exp(-t * 9)
    sig *= env(n, .004, .25, .35, .35, dur) * np.exp(-t * 1.6) * gain
    add(start, sig, pan)

def pad(start, notes, dur, gain=.07, pan=0.0):
    n = int((dur + 1.5) * RATE); t = np.arange(n) / RATE
    sig = np.zeros(n)
    for k, note in enumerate(notes):
        f = midi(note)
        sig += np.sin(2 * np.pi * f * t + .3 * k) + .5 * np.sin(2 * np.pi * f * 1.004 * t) + .18 * np.sin(2 * np.pi * 2 * f * t)
    sig /= len(notes) * 1.7
    sig *= env(n, .9, .4, .85, 1.4, dur) * (.85 + .15 * np.sin(2 * np.pi * .35 * t)) * gain
    add(start, sig, pan)

def bass(start, note, dur=.5, gain=.2):
    n = int((dur + .2) * RATE); t = np.arange(n) / RATE; f = midi(note)
    sig = np.sin(2 * np.pi * f * t) + .25 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t * 5)
    sig *= env(n, .01, .2, .6, .18, dur) * gain
    add(start, sig)

def kick(start, gain=.33):
    n = int(.32 * RATE); t = np.arange(n) / RATE
    f = 52 + 110 * np.exp(-t * 28)
    sig = np.sin(2 * np.pi * np.cumsum(f) / RATE) * np.exp(-t * 11) * gain
    add(start, sig)

def tick(start, gain=.08, pan=0.0, tone=7000):
    n = int(.06 * RATE); t = np.arange(n) / RATE
    noise = rng.standard_normal(n)
    sig = (noise * .5 + .5 * np.sin(2 * np.pi * tone * t)) * np.exp(-t * 90) * gain
    add(start, sig, pan)

def click(start, gain=.16):
    n = int(.09 * RATE); t = np.arange(n) / RATE
    sig = (np.sin(2 * np.pi * 1900 * t) * np.exp(-t * 120) + .4 * rng.standard_normal(n) * np.exp(-t * 300)) * gain
    add(start, sig)

def swell(start, dur, notes, gain=.12):
    n = int((dur + 1.2) * RATE); t = np.arange(n) / RATE
    sig = np.zeros(n)
    for k, note in enumerate(notes):
        f = midi(note)
        sig += np.sin(2 * np.pi * f * t) * (1 + .3 * np.sin(2 * np.pi * (.6 + .1 * k) * t))
    sig /= len(notes)
    rise = np.clip(t / dur, 0, 1) ** 2.2
    tail = np.clip(1 - (t - dur) / 1.2, 0, 1)
    add(start, sig * rise * tail * gain)

def riser(start, dur, gain=.05):
    n = int(dur * RATE); t = np.arange(n) / RATE
    noise = rng.standard_normal(n)
    # Simple one-pole low-pass whose cutoff opens over time.
    out = np.zeros(n); y = 0.0
    alpha = np.linspace(.01, .25, n)
    for i in range(n):
        y += alpha[i] * (noise[i] - y); out[i] = y
    add(start, out * (t / dur) ** 2 * gain)

# ---- Harmony: D major, warm. Chord per bar across the product section. ----
D, Fs, A, B, E, G, Cs = 62, 66, 69, 71, 64, 67, 73
progression = [(D, [D, Fs, A]), (B - 12, [B - 12, D, Fs]), (G - 12, [G - 12, B - 12, D]), (A - 12, [A - 12, Cs, E])]
motif = [74, 78, 81, 78, 86, 81, 78, 74]  # eighth-note arpeggio in D

# Intro (0–7): sparse pad and a single pluck per bar.
pad(0.0, [D - 12, A - 12, D, Fs], 7.2, gain=.055)
for i, t in enumerate([0.3, 2.6, 5.0]):
    pluck(t, [74, 81, 78][i], .9, gain=.09, pan=[-.3, .3, 0][i])
tick(0.25, .05); tick(3.5, .05)
# Reveal (7.1): swell into a bright chord hit.
riser(4.6, 2.5, gain=.04)
swell(5.3, 1.8, [D, Fs, A, D + 12], gain=.1)
kick(7.1, .38); pad(7.1, [D - 12, A - 12, Fs, A, D + 12], 3.6, gain=.09)
for k, note in enumerate([74, 78, 81, 86]):
    pluck(7.15 + k * .07, note, .9, gain=.12, pan=(k - 1.5) * .25)

# Product section (11–58): pulse, bass, motif, chords; intensity steps up per act.
start = 11.0
bar = 0
t = start
while t < 57.6:
    root, chord = progression[bar % 4]
    act = 0 if t < 29 else 1 if t < 50 else 2
    pad(t, chord, BAR, gain=[.05, .06, .07][act])
    for b in range(4):
        bt = t + b * BEAT
        if bt >= 57.6: break
        kick(bt, [.22, .28, .32][act] if b % 2 == 0 else [.14, .18, .22][act])
        bass(bt, root - 12, BEAT * .9, gain=[.13, .16, .18][act])
        if act >= 1 or b % 2 == 1:
            tick(bt + BEAT / 2, .045, pan=.35)
        for e in range(2):
            et = bt + e * BEAT / 2
            idx = (b * 2 + e) % 8
            if act == 0 and idx % 2 == 1 and b < 2: continue
            pluck(et, motif[idx] + (chord[0] - D if chord[0] - D < 0 else 0) * 0, BEAT * .45, gain=[.075, .095, .11][act], pan=math.sin(idx) * .4, bright=.8)
    t += BAR; bar += 1

# Accents aligned to the picture.
for ct in [11.3, 18.4, 25.1, 29.3, 32.5, 36.4, 44.4, 50.4, 53.9]:
    tick(ct, .09, tone=5200)
for clk in [16.95, 21.7, 22.25, 23.5, 42.5, 48.3]:
    click(clk)
# Testers arrive, then the Pro-trial moment.
for k in range(3):
    pluck(18.6 + k * .18, [86, 90, 93][k], .5, gain=.1, pan=-.4 + k * .4)
swell(24.6, 1.2, [A, Cs + 12], gain=.05)
# The approve click lands on a lifted chord; the result swells and resolves.
pad(48.3, [D, Fs, A, D + 12, Fs + 12], 1.6, gain=.09)
riser(50.4, 2.1, gain=.045)
swell(51.4, 1.3, [D, A, D + 12, Fs + 12], gain=.1)
for k, note in enumerate([74, 78, 81, 86, 90]):
    pluck(52.5 + k * .22, note, .7, gain=.12, pan=(k - 2) * .2)
kick(53.6, .36)

# Figma (58–63): calmer, filtered; just pad and a slow motif.
pad(58.0, [G - 12, B - 12, D, Fs], 2.5, gain=.07); pad(60.5, [A - 12, Cs, E, A], 2.6, gain=.07)
for k, tt in enumerate([58.5, 59.6, 60.7, 61.8]):
    pluck(tt, [78, 81, 86, 81][k], 1.0, gain=.08, pan=(k - 1.5) * .3, bright=.5)

# Loop (63–67): the pulse returns and builds to the end card.
for b in range(7):
    bt = 63.05 + b * BEAT
    kick(bt, .26 + b * .015); bass(bt, D - 24, BEAT * .9, gain=.16)
    pluck(bt, motif[b % 8], BEAT * .45, gain=.1, pan=math.sin(b) * .4)
    pluck(bt + BEAT / 2, motif[(b + 4) % 8], BEAT * .45, gain=.08, pan=-math.sin(b) * .4)
for k in range(6):
    tick(63.4 + k * .33, .1, tone=4800)
riser(65.2, 2.1, gain=.05)
# End (67.3): one full chord, then let it ring and fade.
kick(67.35, .4)
pad(67.35, [D - 12, A - 12, D, Fs, A, D + 12], 3.4, gain=.11)
for k, note in enumerate([74, 78, 81, 86]):
    pluck(67.4 + k * .08, note, 1.6, gain=.13, pan=(k - 1.5) * .25)
pluck(68.2, 93, 1.4, gain=.07, pan=.3)

# Master: gentle saturation, fade-out, normalize.
mix = np.stack([L, R])
mix = np.tanh(mix * 1.4) / 1.4
fade = np.ones(N); tail = int(2.2 * RATE); fade[-tail:] = np.linspace(1, 0, tail) ** 1.5
mix *= fade
mix *= .89 / max(1e-9, np.abs(mix).max())
out = Path(__file__).parent / 'output' / 'score.wav'; out.parent.mkdir(exist_ok=True)
pcm = (np.clip(mix.T, -1, 1) * 32767).astype('<i2')
with wave.open(str(out), 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(RATE); w.writeframes(pcm.tobytes())
print(f'Wrote {out} ({DURATION}s, {RATE} Hz stereo)')
