#!/usr/bin/env python3
"""Sound for the expert intro: the narrator, the expert's own voice, the music and the sound effects, mixed.

Inputs (put them in inputs/, they are not kept in git):
  inputs/narrator.mp3          the narration, all lines in order (the first and the last lines of the file may be extra takes: only
                               the part between voice.o1 and voice.tail of timeline.json is used)
  inputs/abdelaziz-voice.wav   the expert's own sentence (his clip is cut at his.dur seconds)
  inputs/portafilter.wav       the coffee-machine sounds (single knocks/clicks, used as separate clips)

  python3 audio.py             -> out/mix.wav (loudness -16 LUFS), out/music.wav, out/sfx.wav, out/voices.wav, out/mouth.json
Everything is placed from timeline.json, the same file the picture uses, so sound and picture cannot drift apart.
Music and effects that are not recordings are made from maths (no samples, nothing to license).
"""
import json, math, os, subprocess, wave
import numpy as np

SR = 44100
HERE = os.path.dirname(os.path.abspath(__file__))
TL = json.load(open(os.path.join(HERE, "timeline.json")))
OUT = os.path.join(HERE, "out"); os.makedirs(OUT, exist_ok=True)
IN = lambda n: os.path.join(HERE, "inputs", n)
TOTAL = TL["total"]
N = int((TOTAL + 2.0) * SR)
rng = np.random.default_rng(7)

# ---------------------------------------------------------------- helpers
def load(path, ss=None, t=None, af=None):
    cmd = ["ffmpeg", "-v", "error"] + (["-ss", str(ss)] if ss else []) + (["-t", str(t)] if t else []) + ["-i", path]
    if af: cmd += ["-af", af]
    cmd += ["-ac", "1", "-ar", str(SR), "-f", "f32le", "-"]
    return np.frombuffer(subprocess.run(cmd, capture_output=True, check=True).stdout, dtype="<f4").astype(np.float64)

def t_of(d): return np.arange(int(d * SR)) / SR
def note(m): return 440.0 * 2 ** ((m - 69) / 12)
def db(x): return 10 ** (x / 20)

def add(buf, at, sig, gain=1.0, pan=0.0):
    i = int(round(at * SR))
    if i >= N or len(sig) == 0: return
    sig = sig[: N - i]
    l = gain * (1 - max(0, pan)); r = gain * (1 + min(0, pan))
    buf[0, i:i + len(sig)] += sig * l; buf[1, i:i + len(sig)] += sig * r

def fade_edges(x, a=0.005, b=0.005):
    x = x.copy(); na, nb = int(a * SR), int(b * SR)
    if na: x[:na] *= np.linspace(0, 1, na)
    if nb: x[-nb:] *= np.linspace(1, 0, nb)
    return x

def active_rms(x, frame=2048):
    r = np.array([np.sqrt((x[i:i + frame] ** 2).mean()) for i in range(0, len(x) - frame, frame // 2)])
    return r, np.percentile(r, 40)

def band_levels(x):
    n, hop = 2048, 1024
    fr = np.fft.rfftfreq(n, 1 / SR); win = np.hanning(n)
    rms, thr = active_rms(x)
    P = [np.abs(np.fft.rfft(x[i:i + n] * win)) ** 2 for k, i in enumerate(range(0, len(x) - n, hop)) if k < len(rms) and rms[min(k * 2 // 2, len(rms) - 1)] > thr]
    P = np.mean(P, 0)
    edges = [80, 125, 200, 315, 500, 800, 1250, 2000, 3150, 5000, 8000, 12000]
    return np.array([10 * np.log10(P[(fr >= a) & (fr < b)].sum() + 1e-12) for a, b in zip(edges[:-1], edges[1:])]), edges

def apply_eq(x, edges, gains_db):
    """Zero-phase EQ: gain (dB) per band centre, glided between them."""
    n = len(x); nfft = 1 << int(np.ceil(np.log2(n + 8192)))
    fr = np.fft.rfftfreq(nfft, 1 / SR)
    centres = np.sqrt(np.array(edges[:-1]) * np.array(edges[1:]))
    g = np.interp(np.log(np.maximum(fr, 1)), np.log(centres), gains_db)
    return np.fft.irfft(np.fft.rfft(x, nfft) * 10 ** (g / 20), nfft)[:n]

def room_ir(rt=0.26, wet=1.0):
    t = t_of(rt * 1.4); ir = rng.standard_normal(len(t)) * np.exp(-t * 6.9 / rt)
    ir[:int(0.004 * SR)] *= np.linspace(0, 1, int(0.004 * SR)); ir /= np.sqrt((ir ** 2).sum())
    return ir * wet
IR = room_ir()
def glue(x, wet=0.07):
    """The same small room around both voices, so they sit in one place."""
    from numpy.fft import rfft, irfft
    nfft = 1 << int(np.ceil(np.log2(len(x) + len(IR))))
    wetsig = irfft(rfft(x, nfft) * rfft(IR, nfft), nfft)[: len(x)]
    return x * (1 - wet * 0.5) + wetsig * wet * 2.2

def compress(x, thr_db=-22, ratio=3.0, attack=0.004, release=0.09):
    """A plain feed-forward compressor, the same settings on every voice."""
    env = np.zeros_like(x); a = math.exp(-1 / (attack * SR)); r = math.exp(-1 / (release * SR)); s = 0.0
    ax = np.abs(x)
    for i in range(len(x)):
        s = a * s + (1 - a) * ax[i] if ax[i] > s else r * s + (1 - r) * ax[i]
        env[i] = s
    lvl = 20 * np.log10(np.maximum(env, 1e-6))
    gain = np.where(lvl > thr_db, (thr_db + (lvl - thr_db) / ratio) - lvl, 0.0)
    return x * 10 ** (gain / 20)

def lufs_gain(x, target):
    """dB to add so that x (speech) reaches `target` LUFS, measured by ffmpeg's EBU R128 meter."""
    tmp = os.path.join(OUT, "_m.wav"); write_mono(tmp, x)
    r = subprocess.run(["ffmpeg", "-nostats", "-i", tmp, "-af", "ebur128=peak=true", "-f", "null", "-"], capture_output=True, text=True).stderr
    i = [float(l.split("I:")[1].split("LUFS")[0]) for l in r.splitlines() if " I:" in l and "LUFS" in l][-1]
    os.remove(tmp); return target - i, i

def write_mono(path, x):
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((np.clip(x, -1, 1) * 32767).astype("<i2").tobytes())
def write(path, x):
    x = np.clip(x, -1, 1)
    with wave.open(path, "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((x.T * 32767).astype("<i2").tobytes())

# ---------------------------------------------------------------- the two voices
V = TL["voice"]; H = TL["his"]
narr = load(IN("narrator.mp3"), 0, V["tail"], af="highpass=f=70")
his = load(IN("abdelaziz-voice.wav"), 0, H["dur"], af="highpass=f=90,afftdn=nr=12:nf=-50")   # the clip is already clean; this only takes out what is left
# 1. tone: bring his voice nearer to the narrator's (capped, so nothing is forced)
bn, edges = band_levels(narr); bh, _ = band_levels(his)
diff = (bn - bn.mean()) - (bh - bh.mean())
CAP = 8.0
gains = np.clip(diff, -CAP, CAP); gains = np.convolve(np.pad(gains, 1, mode="edge"), [0.25, 0.5, 0.25], mode="valid")
his_eq = apply_eq(his, edges, gains)
tone_before = np.abs(diff).mean(); bh2, _ = band_levels(his_eq)
tone_after = np.abs((bn - bn.mean()) - (bh2 - bh2.mean())).mean()
# 2. dynamics and room: the same for both
narr_p = glue(compress(narr)); his_p = glue(compress(his_eq))
# 3. loudness: both speak at the same level
TARGET = -17.0
g1, l1 = lufs_gain(narr_p, TARGET); g2, l2 = lufs_gain(his_p, TARGET)
narr_p *= db(g1); his_p *= db(g2)
print(f"voices: narrator {l1:.1f} -> {TARGET} LUFS, his {l2:.1f} -> {TARGET} LUFS; tone gap {tone_before:.1f} dB -> {tone_after:.1f} dB (average over bands)")

voices = np.zeros((2, N))
c1 = fade_edges(narr_p[: int(V["cut"] * SR)], 0.004, 0.02)
c2 = fade_edges(narr_p[int(V["cut"] * SR):], 0.02, 0.05)
add(voices, V["o1"], c1); add(voices, V["cut"] + V["o2"], c2)
add(voices, H["v0"], fade_edges(his_p, 0.01, 0.08))

# the expert's mouth: how open it is, 30 times a second, from his own recording
fps = 30; hop = SR // fps
env = np.array([np.sqrt((his_p[max(0, i - hop):i + hop] ** 2).mean()) for i in range(0, len(his_p), hop)])
env = env / (np.percentile(env, 92) + 1e-9)
sm = np.zeros_like(env); s = 0.0
for i, v in enumerate(env):
    s = s + (v - s) * (0.7 if v > s else 0.35); sm[i] = s
json.dump({"fps": fps, "t0": H["v0"], "values": [round(float(min(1.0, v)), 3) for v in sm]}, open(os.path.join(OUT, "mouth.json"), "w"))

# ---------------------------------------------------------------- the portafilter clips (his machine, his sounds)
pf = load(IN("portafilter.wav"))
def pclip(a, b, a_fade=0.004, b_fade=0.06): return fade_edges(pf[int(a * SR):int(b * SR)], a_fade, b_fade)
PF_HISS = pclip(0.70, 2.00)      # a metallic click and a hiss, then a rattle
PF_KNOCK_A = pclip(3.95, 4.85)   # a hard knock with a low thud
PF_KNOCK_B = pclip(7.45, 8.10)   # a second knock, lower
PF_TICKS = pclip(5.20, 5.50)

# ---------------------------------------------------------------- made sounds
def env_k(n, a=0.003): e = np.ones(n); k = max(1, int(a * SR)); e[:k] = np.linspace(0, 1, k); return e
def marimba(f, dur=1.2):
    t = t_of(dur); y = np.sin(2 * np.pi * f * t) * np.exp(-t * 4.5) + 0.35 * np.sin(2 * np.pi * 3.99 * f * t) * np.exp(-t * 20) + 0.08 * np.sin(2 * np.pi * 9.2 * f * t) * np.exp(-t * 40)
    y[:int(0.003 * SR)] *= np.linspace(0, 1, int(0.003 * SR)); return y
def bell(f, dur=1.6):
    t = t_of(dur); y = sum(a * np.sin(2 * np.pi * f * r * t) * np.exp(-t * d) for r, a, d in [(1, 1, 3.2), (2.76, .35, 5), (5.4, .15, 9)])
    y[:int(0.002 * SR)] *= np.linspace(0, 1, int(0.002 * SR)); return y
def bass(f, dur=0.6):
    t = t_of(dur); y = (np.sin(2 * np.pi * f * t) + 0.25 * np.sin(4 * np.pi * f * t)) * np.exp(-t * 5.5); y[:int(0.004 * SR)] *= np.linspace(0, 1, int(0.004 * SR)); return y
def kick(dur=0.3):
    t = t_of(dur); f = 45 + 90 * np.exp(-t * 30); return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 14)
def noise(d): return rng.standard_normal(int(d * SR))
def hp(x, a=0.95):
    y = np.zeros_like(x); px = 0.0; py = 0.0
    for i, v in enumerate(x): py = a * (py + v - px); px = v; y[i] = py
    return y
def lp_sweep(x, f0, f1):
    y = np.zeros_like(x); s = 0.0; n = len(x)
    for i in range(n):
        f = f0 + (f1 - f0) * (i / max(1, n - 1)); a = 1 - math.exp(-2 * math.pi * f / SR); s += a * (x[i] - s); y[i] = s
    return y
def shaker(dur=0.07, acc=1.0): return hp(noise(dur)) * np.exp(-t_of(dur) * 55) * 0.5 * acc
def clap(dur=0.16):
    t = t_of(dur); return hp(noise(dur), 0.9) * np.exp(-t * 28) * (1 + 0.8 * (np.sin(2 * np.pi * 90 * t) > 0)) * 0.35
def sfx_pop(f=520, dur=0.16):
    t = t_of(dur); return np.sin(2 * np.pi * np.cumsum(f * (0.75 + 0.9 * (1 - np.exp(-t * 40)))) / SR) * np.exp(-t * 26) * 0.9
def sfx_boing(f=300, dur=0.5):
    t = t_of(dur); fr = f * (1 + 0.9 * np.exp(-t * 9)) * (1 + 0.05 * np.sin(2 * np.pi * 14 * t)); ph = np.cumsum(fr) / SR
    return (np.sin(2 * np.pi * ph) + 0.3 * np.sin(4 * np.pi * ph)) * np.exp(-t * 7) * 0.7
def sfx_whoosh(dur=0.5, up=True, level=0.5):
    y = lp_sweep(noise(dur), 300, 5000) if up else lp_sweep(noise(dur), 5000, 300)
    return y * np.sin(np.pi * np.clip(t_of(dur) / dur, 0, 1)) ** 1.6 * level * 0.5
def sfx_twinkle(base=2093, dur=0.9):
    out = np.zeros(int(dur * SR))
    for k, r in enumerate([1, 1.26, 1.5, 2.0]):
        s = np.sin(2 * np.pi * base * r * t_of(dur)) * np.exp(-t_of(dur) * 7); d = int(k * 0.06 * SR); out[d:] += s[: len(out) - d] * 0.35
    return out
def sfx_click(dur=0.06):
    t = t_of(dur); return hp(noise(dur), 0.8) * np.exp(-t * 160) * 0.6 + np.sin(2 * np.pi * 1800 * t) * np.exp(-t * 120) * 0.5
def sfx_clink(dur=0.4):
    t = t_of(dur); return (np.sin(2 * np.pi * 3520 * t) * np.exp(-t * 14) + 0.6 * np.sin(2 * np.pi * 5230 * t) * np.exp(-t * 20) + 0.3 * np.sin(2 * np.pi * 7050 * t) * np.exp(-t * 28)) * 0.5
def sfx_tick(dur=0.05): t = t_of(dur); return np.sin(2 * np.pi * 1200 * t) * np.exp(-t * 90) * 0.5
def sfx_swish(dur=0.25): return sfx_whoosh(dur, True, 0.35)
def sfx_scratch(dur=0.55):
    """The music stops: a record scratch (a quick pitch drop and a rasp)."""
    t = t_of(dur); f = 900 * np.exp(-t * 5) + 60; saw = 2 * ((np.cumsum(f) / SR) % 1) - 1
    rasp = hp(noise(dur), 0.7) * 0.5
    return (saw * 0.5 + rasp) * np.exp(-t * 4.5) * np.clip(t / 0.01, 0, 1) * 0.9
def sfx_riser(dur=0.55):
    t = t_of(dur); y = lp_sweep(noise(dur), 400, 7000) * 0.4 + np.sin(2 * np.pi * np.cumsum(200 + 1400 * (t / dur) ** 2) / SR) * 0.18
    return y * (t / dur) ** 1.4
def sfx_boom(dur=0.9):
    t = t_of(dur); return np.sin(2 * np.pi * np.cumsum(38 + 90 * np.exp(-t * 14)) / SR) * np.exp(-t * 4.2) * 0.9
def sfx_pump(dur=0.8):
    """An espresso pump: a low buzzing hum with a little wobble, fading in and out."""
    t = t_of(dur); y = (np.sin(2 * np.pi * 95 * t) + 0.5 * np.sin(2 * np.pi * 190 * t) + 0.25 * np.sin(2 * np.pi * 285 * t)) * (1 + 0.15 * np.sin(2 * np.pi * 23 * t))
    return y * np.clip(t / 0.06, 0, 1) * np.clip((dur - t) / 0.12, 0, 1) * 0.22
def sfx_pour(dur=0.9):
    """Coffee falling into a cup: a thin stream whose pitch climbs as the cup fills, with small bubbles."""
    t = t_of(dur); stream = lp_sweep(hp(noise(dur), 0.9), 1800, 4200) * 0.35
    fl = 500 + 1500 * (t / dur) ** 1.3
    tone = np.sin(2 * np.pi * np.cumsum(fl) / SR) * 0.07 * (1 + np.sin(2 * np.pi * 31 * t))
    b = np.zeros_like(t)
    for _ in range(int(dur * 14)):
        at = rng.uniform(0, dur - 0.08); f0 = rng.uniform(600, 1700); k = int(at * SR); tt = t_of(0.07)
        b[k:k + len(tt)] += np.sin(2 * np.pi * f0 * (1 + 4 * tt) * tt) * np.exp(-tt * 55) * 0.14
    return (stream + tone + b) * np.clip(t / 0.05, 0, 1) * np.clip((dur - t) / 0.2, 0, 1)
def sfx_steam(dur=2.2): t = t_of(dur); return hp(noise(dur), 0.97) * np.clip(t / 0.3, 0, 1) * np.clip((dur - t) / 0.8, 0, 1) * 0.07
def sfx_sip(dur=0.7):
    """A small slurp: a bubbly sweep, then a soft swallow."""
    t = t_of(dur); sl = lp_sweep(hp(noise(0.45), 0.9), 900, 2600) * np.sin(np.pi * np.clip(t_of(0.45) / 0.45, 0, 1)) * 0.28
    out = np.zeros(len(t)); out[: len(sl)] += sl
    k = int(0.52 * SR); tt = t_of(0.14); out[k:k + len(tt)] += np.sin(2 * np.pi * np.cumsum(180 - 90 * tt / 0.14) / SR) * np.exp(-tt * 22) * 0.4
    return out

# ---------------------------------------------------------------- sound effects, placed from the timeline
A, B, C, D, E = TL["A"], TL["B"], TL["C"], TL["D"], TL["E"]
sfx = np.zeros((2, N))
add(sfx, A["logo"], sfx_pop(780), 0.8); add(sfx, A["logo"] + 0.02, sfx_twinkle(2637, 0.6), 0.4)
for i, ts in enumerate(A["h1"]): add(sfx, ts, sfx_pop(420 + 60 * i), 0.5, -0.2)
for i, ts in enumerate(A["h2"]): add(sfx, ts, sfx_pop(500 + 55 * i), 0.5, 0.2)
add(sfx, A["swirl"], sfx_whoosh(0.7, True, 0.3), 0.7, -0.5); add(sfx, A["spark"], sfx_twinkle(2349, 0.8), 0.6, -0.4)
add(sfx, A["sub1"], sfx_tick(), 0.7); add(sfx, A["sub2"], sfx_tick(), 0.7); add(sfx, A["arrow"], sfx_whoosh(0.4, False, 0.3), 0.7, 0.5)
for i, (ts, f) in enumerate(zip(A["slimes"], [196, 247, 294, 220])): add(sfx, ts, sfx_boing(f), 0.7, [-0.5, -0.2, 0.5, 0.0][i])
add(sfx, A["card"], sfx_whoosh(0.35, True, 0.45), 0.8); add(sfx, A["card"] + 0.3, bell(1319, 1.0), 0.4)
add(sfx, A["photo"], sfx_pop(900), 0.6); add(sfx, A["ticks"], sfx_twinkle(3136, 0.7), 0.5)
add(sfx, A["pill"], sfx_pop(360), 0.8); add(sfx, A["pill"] + 0.05, bell(1047, 0.8), 0.3)
# he asks for the music to stop
add(sfx, B["in"], sfx_scratch(), 0.9); add(sfx, B["in"] + 0.03, sfx_whoosh(0.5, False, 0.6), 0.7)
# the coffee: his machine's own sounds, then the pump and the pour
add(sfx, B["machine"], sfx_whoosh(0.4, True, 0.45), 0.7, -0.4); add(sfx, B["machine"] + 0.22, PF_KNOCK_A, 0.9, -0.4)
add(sfx, B["go"], sfx_whoosh(0.35, True, 0.3), 0.6, -0.2)
add(sfx, B["lock"], PF_KNOCK_B, 0.9, -0.4)
add(sfx, B["brew"] - 0.1, PF_HISS, 0.8, -0.4)
add(sfx, B["brew"] + 0.05, sfx_pump(0.95), 0.9, -0.4); add(sfx, B["brew"] + 0.2, sfx_pour(0.85), 0.95, -0.3); add(sfx, B["brew"] + 0.3, sfx_steam(1.6), 0.9, -0.3)
add(sfx, B["grab"], sfx_clink(), 0.8, -0.2); add(sfx, B["back"], sfx_whoosh(0.4, True, 0.25), 0.6)
add(sfx, B["sip"], sfx_sip(), 0.9); add(sfx, B["sip"] + 0.55, sfx_twinkle(2093, 0.8), 0.5)
add(sfx, B["lower"], sfx_clink(), 0.5)
add(sfx, B["musicBack"] - 0.55, sfx_riser(0.55), 0.9); add(sfx, B["musicBack"], sfx_boom(), 0.9)
# the app, the mouse
add(sfx, C["in"], sfx_whoosh(0.5, True, 0.5), 0.7); add(sfx, C["cursorStart"] + 0.1, sfx_whoosh(0.9, True, 0.12), 0.6)
add(sfx, C["tabClick"], sfx_click(), 1.0); add(sfx, C["tabClick"] + 0.05, sfx_swish(), 0.55); add(sfx, C["ring"], sfx_twinkle(2093, 0.8), 0.5)
add(sfx, C["cardMove"] + 0.1, sfx_whoosh(0.7, True, 0.12), 0.6)
add(sfx, C["cardClick"], sfx_click(), 1.0); add(sfx, C["cardClick"] + 0.08, sfx_pop(640), 0.8); add(sfx, C["zoom"], sfx_whoosh(0.9, True, 0.45), 0.7)
add(sfx, C["zoom"] + 0.3, bell(1568, 1.0), 0.3); add(sfx, C["out"], sfx_whoosh(0.4, True, 0.55), 0.7)
add(sfx, D["in"], sfx_pop(520), 0.8); add(sfx, D["inv2"], sfx_pop(600), 0.7); add(sfx, D["apply"], sfx_pop(440), 0.8)
add(sfx, D["url"], sfx_tick(), 0.7); add(sfx, D["out"], sfx_whoosh(0.4, True, 0.55), 0.7)
add(sfx, E["in"], sfx_pop(780), 0.8); add(sfx, E["in"] + 0.02, sfx_twinkle(2637, 0.7), 0.45)
add(sfx, E["fin1"], sfx_pop(480), 0.8); add(sfx, E["fin2"], sfx_pop(540), 0.8); add(sfx, E["cta"], sfx_pop(320), 0.9)
for k, m in enumerate([72, 76, 79, 84]): add(sfx, E["cta"] + 0.08 + k * 0.09, bell(note(m), 1.8), 0.35)
add(sfx, E["site"], sfx_tick(), 0.7)

# ---------------------------------------------------------------- music: marimba, bass, light drums, 104 BPM, C - Am - F - G
BPM = 104.0; beat = 60.0 / BPM; bar = 4 * beat
chords = [(48, [60, 64, 67]), (45, [57, 60, 64]), (41, [57, 60, 65]), (43, [55, 59, 62])]
motif = [[(0, 79), (1.5, 76), (2, 79), (3, 81)], [(0, 81), (1.5, 79), (2, 76), (3, 72)], [(0, 77), (1.5, 81), (2, 84), (3, 81)], [(0, 79), (1, 83), (2, 79), (3.5, 74)]]
music = np.zeros((2, N))
def play(t_from, t_to, soft_from=None, soft_to=None, tune=True):
    nb = int((t_to - t_from) / bar) + 1
    for b in range(nb):
        t0 = t_from + b * bar; root, tones = chords[b % 4]
        soft = 0.55 if (soft_from is not None and soft_from <= t0 < soft_to) else 1.0
        for s in range(8):
            tt = t0 + s * beat / 2
            if tt >= t_to: break
            m = tones[[0, 1, 2, 1, 0, 1, 2, 1][s]] + (12 if s % 4 == 2 else 0)
            add(music, tt, marimba(note(m), 0.9), 0.20 * soft, -0.3 if s % 2 else 0.3)
            add(music, tt, shaker(acc=1.0 if s % 2 else 0.5), 0.5 * soft, 0.4 if s % 2 else -0.4)
        if tune:
            for bt, m in motif[b % 4]:
                if t0 + bt * beat < t_to and (b >= 1 or t_from > 1): add(music, t0 + bt * beat, marimba(note(m), 1.1), 0.24 * soft, 0.2)
        for bt in (0, 2.5):
            if t0 + bt * beat < t_to: add(music, t0 + bt * beat, bass(note(root), 0.6), 0.5)
        for bt in (0, 2):
            if t0 + bt * beat < t_to: add(music, t0 + bt * beat, kick(), 0.55 * soft)
        for bt in (1, 3):
            if t0 + bt * beat < t_to: add(music, t0 + bt * beat, clap(), 0.4 * soft)
play(0.0, B["in"])                               # the poster
END_HIT = V["cut"] + V["o2"] + (V["tail"] - V["cut"]) + 0.2
play(B["musicBack"], END_HIT, C["in"], C["out"])  # after his sentence
# cut cleanly where the music has to stop or end (a short fade so there is no click)
def stop_at(buf, t, fade=0.05, until=None):
    i = int(t * SR); n = int(fade * SR); j = N if until is None else int(until * SR)
    buf[:, i:i + n] *= np.linspace(1, 0, n); buf[:, i + n:j] = 0
stop_at(music, B["in"], 0.12, B["musicBack"] - 0.02)
stop_at(music, END_HIT - 0.0, 0.04)
for m in (48, 60, 64, 67, 72): add(music, END_HIT, marimba(note(m), 2.6), 0.28)
add(music, END_HIT, bell(note(84), 2.6), 0.25); add(music, END_HIT, kick(), 0.5)

# ---------------------------------------------------------------- mix: the music steps back under every voice
def smooth_env(x, win=0.18):
    a = np.abs(x); k = int(win * SR); c = np.cumsum(np.insert(a, 0, 0)); e = (c[k:] - c[:-k]) / k
    return np.concatenate([e, np.zeros(len(x) - len(e))])
venv = smooth_env(voices.mean(0)); venv = np.clip(venv / (np.percentile(venv[venv > 0], 90) + 1e-9), 0, 1)
duck = 1 - 0.6 * np.convolve(venv, np.hanning(int(0.2 * SR)) / np.hanning(int(0.2 * SR)).sum(), mode="same")
music_d = music * duck

def fade(x, a, b):
    n = x.shape[1]; g = np.ones(n); g[: int(a * SR)] = np.linspace(0, 1, int(a * SR)); g[n - int(b * SR):] = np.linspace(1, 0, int(b * SR)); return x * g
total_n = int(TOTAL * SR)
mix = voices * 1.0 + music_d * 0.42 + sfx * 0.6
mix = fade(mix[:, :total_n], 0.01, 0.7)
pre = os.path.join(OUT, "_premaster.wav"); write(pre, mix / max(1e-9, np.abs(mix).max()) * 0.8)
# loudness: -16 LUFS integrated (what phones and social apps expect), true peak under -1.5 dB
meas = subprocess.run(["ffmpeg", "-nostats", "-i", pre, "-af", "loudnorm=I=-16:TP=-1.5:LRA=9:print_format=json", "-f", "null", "-"], capture_output=True, text=True).stderr
j = json.loads(meas[meas.rindex("{"):meas.rindex("}") + 1])
subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", pre, "-af",
    f"loudnorm=I=-16:TP=-1.5:LRA=9:measured_I={j['input_i']}:measured_TP={j['input_tp']}:measured_LRA={j['input_lra']}:measured_thresh={j['input_thresh']}:offset={j['target_offset']}:linear=true",
    "-ar", str(SR), "-c:a", "pcm_s16le", os.path.join(OUT, "mix.wav")], check=True)
os.remove(pre)
write(os.path.join(OUT, "music.wav"), music_d[:, :total_n] / max(1e-9, np.abs(music_d).max()) * 0.89)
write(os.path.join(OUT, "sfx.wav"), sfx[:, :total_n] / max(1e-9, np.abs(sfx).max()) * 0.89)
write(os.path.join(OUT, "voices.wav"), voices[:, :total_n] / max(1e-9, np.abs(voices).max()) * 0.89)
fin = subprocess.run(["ffmpeg", "-nostats", "-i", os.path.join(OUT, "mix.wav"), "-af", "ebur128=peak=true", "-f", "null", "-"], capture_output=True, text=True).stderr
print("mix:", [l.strip() for l in fin.splitlines() if l.strip().startswith(("I:", "Peak:"))][-2:], f"({TOTAL} s)")
