#!/usr/bin/env python3
"""Music and sound effects for the expert intro, made from nothing but maths (no samples, nothing to license).
Every sound effect is placed from timeline.json, the same file the picture uses, so they cannot drift apart.

  python3 audio.py            -> out/music.wav, out/sfx.wav, out/mix.wav
  python3 audio.py --voice v.mp3   also writes out/mix-voice.wav: the music ducks under the voice
"""
import json, math, os, subprocess, sys, wave
import numpy as np

SR = 44100
HERE = os.path.dirname(os.path.abspath(__file__))
TL = json.load(open(os.path.join(HERE, "timeline.json")))
OUT = os.path.join(HERE, "out")
os.makedirs(OUT, exist_ok=True)
N = int((TL["total"] + 2.0) * SR)
rng = np.random.default_rng(7)

def t_of(d): return np.arange(int(d * SR)) / SR
def note(m): return 440.0 * 2 ** ((m - 69) / 12)

def add(buf, at, sig, gain=1.0, pan=0.0):
    i = int(at * SR)
    if i >= N: return
    sig = sig[: N - i]
    l = gain * (1 - max(0, pan)); r = gain * (1 + min(0, pan))
    buf[0, i:i + len(sig)] += sig * l
    buf[1, i:i + len(sig)] += sig * r

def env_ad(n, a=0.004, d=8.0):
    t = np.arange(n) / SR
    e = np.exp(-t * d)
    k = max(1, int(a * SR)); e[:k] *= np.linspace(0, 1, k)
    return e

# ---------- instruments ----------
def marimba(f, dur=1.2):
    t = t_of(dur)
    y = np.sin(2 * np.pi * f * t) * np.exp(-t * 4.5) + 0.35 * np.sin(2 * np.pi * 3.99 * f * t) * np.exp(-t * 20) + 0.08 * np.sin(2 * np.pi * 9.2 * f * t) * np.exp(-t * 40)
    k = int(0.003 * SR); y[:k] *= np.linspace(0, 1, k)
    return y

def bell(f, dur=1.6):
    t = t_of(dur)
    y = sum(a * np.sin(2 * np.pi * f * r * t) * np.exp(-t * d) for r, a, d in [(1, 1, 3.2), (2.76, .35, 5), (5.4, .15, 9)])
    k = int(0.002 * SR); y[:k] *= np.linspace(0, 1, k)
    return y

def bass(f, dur=0.5):
    t = t_of(dur)
    y = (np.sin(2 * np.pi * f * t) + 0.25 * np.sin(2 * np.pi * 2 * f * t)) * np.exp(-t * 5.5)
    k = int(0.004 * SR); y[:k] *= np.linspace(0, 1, k)
    return y

def kick(dur=0.3):
    t = t_of(dur)
    f = 45 + 90 * np.exp(-t * 30)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 14)

def noise(dur): return rng.standard_normal(int(dur * SR))
def hp(x, a=0.95):  # simple high-pass
    y = np.zeros_like(x); prev_x = 0.0; prev_y = 0.0
    for i, v in enumerate(x):
        prev_y = a * (prev_y + v - prev_x); prev_x = v; y[i] = prev_y
    return y
def lp_sweep(x, f0, f1):  # low-pass whose cut-off glides from f0 to f1 Hz
    y = np.zeros_like(x); s = 0.0; n = len(x)
    for i in range(n):
        f = f0 + (f1 - f0) * (i / max(1, n - 1))
        a = 1 - math.exp(-2 * math.pi * f / SR)
        s += a * (x[i] - s); y[i] = s
    return y

def shaker(dur=0.07, acc=1.0):
    n = noise(dur); return hp(n) * np.exp(-t_of(dur) * 55) * 0.5 * acc
def clap(dur=0.16):
    n = hp(noise(dur), 0.9)
    t = t_of(dur); e = np.exp(-t * 28) * (1 + 0.8 * (np.sin(2 * np.pi * 90 * t) > 0))
    return n * e * 0.35

# ---------- sound effects ----------
def sfx_pop(f=520, dur=0.16):
    t = t_of(dur)
    fr = f * (0.75 + 0.9 * (1 - np.exp(-t * 40)))
    return np.sin(2 * np.pi * np.cumsum(fr) / SR) * np.exp(-t * 26) * 0.9
def sfx_boing(f=300, dur=0.5):
    t = t_of(dur)
    fr = f * (1 + 0.9 * np.exp(-t * 9)) * (1 + 0.05 * np.sin(2 * np.pi * 14 * t))
    return (np.sin(2 * np.pi * np.cumsum(fr) / SR) + 0.3 * np.sin(4 * np.pi * np.cumsum(fr) / SR)) * np.exp(-t * 7) * 0.7
def sfx_whoosh(dur=0.5, up=True, level=0.5):
    n = noise(dur)
    y = lp_sweep(n, 300, 5000) if up else lp_sweep(n, 5000, 300)
    t = t_of(dur); e = np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 1.6
    return y * e * level * 0.5
def sfx_twinkle(base=2093, dur=0.9):
    out = np.zeros(int(dur * SR))
    for k, r in enumerate([1, 1.26, 1.5, 2.0]):
        s = np.sin(2 * np.pi * base * r * t_of(dur)) * np.exp(-t_of(dur) * 7)
        d = int(k * 0.06 * SR); out[d:] += s[: len(out) - d] * 0.35
    return out
def sfx_click(dur=0.06):
    t = t_of(dur); return (hp(noise(dur), 0.8) * np.exp(-t * 160) * 0.6 + np.sin(2 * np.pi * 1800 * t) * np.exp(-t * 120) * 0.5)
def sfx_clink(dur=0.4):
    t = t_of(dur)
    return (np.sin(2 * np.pi * 3520 * t) * np.exp(-t * 14) + 0.6 * np.sin(2 * np.pi * 5230 * t) * np.exp(-t * 20) + 0.3 * np.sin(2 * np.pi * 7050 * t) * np.exp(-t * 28)) * 0.5
def sfx_steam(dur=2.2):
    n = hp(noise(dur), 0.97); t = t_of(dur)
    return n * np.clip(t / 0.3, 0, 1) * np.clip((dur - t) / 0.8, 0, 1) * 0.07
def sfx_tick(dur=0.05):
    t = t_of(dur); return np.sin(2 * np.pi * 1200 * t) * np.exp(-t * 90) * 0.5
def sfx_swish(dur=0.25):
    return sfx_whoosh(dur, True, 0.35)

ev = lambda a, *keys: a  # readability only
A, B, C, D, E = TL["A"], TL["B"], TL["C"], TL["D"], TL["E"]
sfx = np.zeros((2, N))
gain = 0.8

# A: the poster builds itself, fast
add(sfx, A["logo"], sfx_pop(780), gain, 0.0); add(sfx, A["logo"] + 0.02, sfx_twinkle(2637, 0.6), 0.5)
for i, ts in enumerate(A["h1"]): add(sfx, ts, sfx_pop(420 + 60 * i), 0.75, -0.2)
for i, ts in enumerate(A["h2"]): add(sfx, ts, sfx_pop(500 + 55 * i), 0.75, 0.2)
add(sfx, A["swirl"], sfx_whoosh(0.7, True, 0.35), 0.8, -0.5)
add(sfx, A["spark"], sfx_twinkle(2349, 0.8), 0.7, -0.4)
add(sfx, A["sub1"], sfx_tick(), 0.8); add(sfx, A["sub2"], sfx_tick(), 0.8)
add(sfx, A["arrow"], sfx_whoosh(0.4, False, 0.35), 0.8, 0.5)
for i, (ts, f) in enumerate(zip(A["slimes"], [196, 247, 294, 220])): add(sfx, ts, sfx_boing(f), 0.8, [-0.5, -0.2, 0.5, 0.0][i])
add(sfx, A["card"], sfx_whoosh(0.35, True, 0.5), 0.9); add(sfx, A["card"] + 0.3, bell(1319, 1.0), 0.45)
add(sfx, A["photo"], sfx_pop(900), 0.7)
add(sfx, A["ticks"], sfx_twinkle(3136, 0.7), 0.6)
add(sfx, A["pill"], sfx_pop(360), 0.9); add(sfx, A["pill"] + 0.05, bell(1047, 0.8), 0.35)
add(sfx, A["out"], sfx_whoosh(0.5, True, 0.7), 0.9)
# B: his line, then the coffee
add(sfx, B["beat1"], sfx_pop(300), 0.9); add(sfx, B["beat2"], sfx_pop(340), 0.9)
add(sfx, B["out"], sfx_whoosh(0.4, True, 0.5), 0.8)
add(sfx, B["coffee"], sfx_pop(260), 0.9); add(sfx, B["coffee"] + 0.35, sfx_pop(330), 0.9)
add(sfx, B["cup"], sfx_boing(180, 0.5), 0.8); add(sfx, B["cup"] + 0.32, sfx_clink(), 0.9); add(sfx, B["cup"] + 0.35, sfx_steam(2.4), 1.0)
add(sfx, B["slimesOut"], sfx_whoosh(0.5, False, 0.7), 0.9)
# C: the real app, and the mouse
add(sfx, C["in"], sfx_whoosh(0.6, True, 0.6), 0.8)
add(sfx, C["cursorStart"] + 0.1, sfx_whoosh(0.9, True, 0.12), 0.7)
add(sfx, C["tabClick"], sfx_click(), 1.0); add(sfx, C["tabClick"] + 0.05, sfx_swish(), 0.6)
add(sfx, C["ring"], sfx_twinkle(2093, 0.8), 0.6)
add(sfx, C["cardMove"] + 0.1, sfx_whoosh(0.7, True, 0.12), 0.7)
add(sfx, C["cardClick"], sfx_click(), 1.0)
add(sfx, C["cardClick"] + 0.08, sfx_pop(640), 0.9); add(sfx, C["zoom"], sfx_whoosh(0.9, True, 0.5), 0.8)
add(sfx, C["zoom"] + 0.3, bell(1568, 1.0), 0.35)
add(sfx, C["out"], sfx_whoosh(0.4, True, 0.6), 0.8)
# D: invite
add(sfx, D["in"], sfx_pop(520), 0.9); add(sfx, D["inv2"], sfx_pop(600), 0.8); add(sfx, D["apply"], sfx_pop(440), 0.9)
add(sfx, D["url"], sfx_tick(), 0.8)
add(sfx, D["out"], sfx_whoosh(0.4, True, 0.6), 0.8)
# E: the call
add(sfx, E["in"], sfx_pop(780), 0.9); add(sfx, E["in"] + 0.02, sfx_twinkle(2637, 0.7), 0.5)
add(sfx, E["fin1"], sfx_pop(480), 0.9); add(sfx, E["fin2"], sfx_pop(540), 0.9)
add(sfx, E["cta"], sfx_pop(320), 1.0)
for k, m in enumerate([72, 76, 79, 84]): add(sfx, E["cta"] + 0.08 + k * 0.09, bell(note(m), 1.8), 0.4)
add(sfx, E["site"], sfx_tick(), 0.8)

# ---------- music: marimba, bass, light drums, 104 BPM, C - Am - F - G ----------
BPM = 104.0; beat = 60.0 / BPM; bar = 4 * beat
music = np.zeros((2, N))
chords = [(48, [60, 64, 67]), (45, [57, 60, 64]), (41, [57, 60, 65]), (43, [55, 59, 62])]   # bass root, chord tones
motif = [  # (beat, midi) per bar, a little tune that sits above the arpeggio
    [(0, 79), (1.5, 76), (2, 79), (3, 81)], [(0, 81), (1.5, 79), (2, 76), (3, 72)],
    [(0, 77), (1.5, 81), (2, 84), (3, 81)], [(0, 79), (1, 83), (2, 79), (3.5, 74)],
]
nbars = int((TL["total"] - 1.0) / bar) + 1
for b in range(nbars):
    t0 = b * bar
    root, tones = chords[b % 4]
    soft = 0.55 if C["in"] <= t0 < C["out"] else 1.0      # leave the middle calmer while the app is shown
    for s in range(8):                                    # arpeggio in eighths
        m = tones[[0, 1, 2, 1, 0, 1, 2, 1][s]] + (12 if s % 4 == 2 else 0)
        add(music, t0 + s * beat / 2, marimba(note(m), 0.9), 0.20 * soft, -0.3 if s % 2 else 0.3)
    for bt, m in motif[b % 4]:
        if b >= 1: add(music, t0 + bt * beat, marimba(note(m), 1.1), 0.24 * soft, 0.2)
    for bt in (0, 2.5):                                   # bass
        add(music, t0 + bt * beat, bass(note(root), 0.6), 0.5)
    for s in range(8):                                    # shaker on the off-beats
        add(music, t0 + s * beat / 2, shaker(acc=1.0 if s % 2 else 0.5), 0.5 * soft, 0.4 if s % 2 else -0.4)
    for bt in (0, 2):                                     # soft kick
        add(music, t0 + bt * beat, kick(), 0.55 * soft)
    for bt in (1, 3):                                     # clap
        add(music, t0 + bt * beat, clap(), 0.4 * soft)
# the ending: one clean tonic chord, ringing out
end = nbars * bar
if end < TL["total"] - 0.5: end = (nbars - 1) * bar + bar
for m in (48, 60, 64, 67, 72): add(music, min(end, TL["total"] - 1.8), marimba(note(m), 2.5), 0.28)
add(music, min(end, TL["total"] - 1.8), bell(note(84), 2.5), 0.25)

# ---------- mix ----------
def fade(x, a, b):
    n = x.shape[1]; g = np.ones(n)
    g[: int(a * SR)] = np.linspace(0, 1, int(a * SR))
    g[n - int(b * SR):] = np.linspace(1, 0, int(b * SR))
    return x * g
def finish(x, peak=0.89):
    m = np.max(np.abs(x)) or 1; return x / m * peak
def write(path, x):
    x = np.clip(x, -1, 1)
    with wave.open(path, "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((x.T * 32767).astype("<i2").tobytes())

total_n = int(TL["total"] * SR)
music = fade(music[:, :total_n + SR // 2], 0.2, 1.2)[:, :total_n]
sfx = sfx[:, :total_n]
write(os.path.join(OUT, "music.wav"), finish(music))
write(os.path.join(OUT, "sfx.wav"), finish(sfx))
mix = finish(music * 0.55 + sfx * 0.9, 0.85)
write(os.path.join(OUT, "mix.wav"), mix)
print("written:", ", ".join(f for f in ("music.wav", "sfx.wav", "mix.wav")), f"({TL['total']} s)")

if "--voice" in sys.argv:
    voice = sys.argv[sys.argv.index("--voice") + 1]
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", os.path.join(OUT, "music.wav"), "-i", os.path.join(OUT, "sfx.wav"), "-i", voice,
        "-filter_complex", "[2:a]aformat=sample_rates=44100:channel_layouts=stereo,asplit=2[v][sc];[0:a]volume=0.6[m];[m][sc]sidechaincompress=threshold=0.03:ratio=9:attack=15:release=350[md];"
        "[1:a]volume=0.8[s];[md][s][v]amix=inputs=3:normalize=0,alimiter=limit=0.9[o]", "-map", "[o]", "-t", str(TL["total"]), os.path.join(OUT, "mix-voice.wav")], check=True)
    print("written: mix-voice.wav")
