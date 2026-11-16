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

# ---------------------------------------------------------------- made sounds (modern, restrained)
def lowpass_fft(x, fc, order=4):
    n = len(x); nfft = 1 << int(np.ceil(np.log2(n + 8)))
    fr = np.fft.rfftfreq(nfft, 1 / SR); g = 1 / np.sqrt(1 + (fr / fc) ** (2 * order))
    return np.fft.irfft(np.fft.rfft(x, nfft) * g, nfft)[:n]
def highpass_fft(x, fc, order=2):
    n = len(x); nfft = 1 << int(np.ceil(np.log2(n + 8)))
    fr = np.fft.rfftfreq(nfft, 1 / SR); r = (fr / fc) ** (2 * order); g = np.sqrt(r / (1 + r))
    return np.fft.irfft(np.fft.rfft(x, nfft) * g, nfft)[:n]
def noise(d): return rng.standard_normal(int(d * SR))
def adsr(n, a, r):
    e = np.ones(n); na = max(1, int(a * SR)); nr = max(1, int(r * SR)); e[:na] = np.linspace(0, 1, na); e[-nr:] *= np.linspace(1, 0, nr); return e
def saw_bl(f, t, nh=14):
    return sum(np.sin(2 * np.pi * f * k * t) / k for k in range(1, nh + 1) if f * k < 9000) * 0.55

def pad_chord(tones, dur, cutoff=1500):
    t = t_of(dur); out = np.zeros(len(t))
    for m in tones:
        for det in (-9, 0, 9):
            out += saw_bl(note(m) * 2 ** (det / 1200), t) / (3 * len(tones))
    out = lowpass_fft(out, cutoff, 3)
    return out * adsr(len(t), 0.5, 0.9)
def pluck(f, dur=0.5):
    t = t_of(dur); y = (np.sin(2 * np.pi * f * t) + 0.35 * np.sin(4 * np.pi * f * t) * np.exp(-t * 14) + 0.12 * np.sin(6 * np.pi * f * t) * np.exp(-t * 25)) * np.exp(-t * 8.5)
    y[:int(0.002 * SR)] *= np.linspace(0, 1, int(0.002 * SR)); return y
def sub(f, dur=0.9):
    t = t_of(dur); y = (np.sin(2 * np.pi * f * t) + 0.18 * np.sin(4 * np.pi * f * t)) * np.exp(-t * 2.6); y *= adsr(len(t), 0.01, 0.12); return y
def kick(dur=0.34):
    t = t_of(dur); f = 48 + 100 * np.exp(-t * 34); return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 11) * 0.95
def hat(v=1.0, dur=0.05): t = t_of(dur); return highpass_fft(noise(dur), 7000, 2) * np.exp(-t * 80) * 0.22 * v
def rim(dur=0.14):
    t = t_of(dur); n = lowpass_fft(highpass_fft(noise(dur), 900, 2), 5200, 2) * np.exp(-t * 30); return (n * 0.6 + np.sin(2 * np.pi * 330 * t) * np.exp(-t * 40) * 0.3) * 0.5
def bell(f, dur=1.6):
    t = t_of(dur); y = sum(a * np.sin(2 * np.pi * f * r * t) * np.exp(-t * d) for r, a, d in [(1, 1, 3.4), (2.76, .3, 5.5), (5.4, .12, 10)])
    y[:int(0.002 * SR)] *= np.linspace(0, 1, int(0.002 * SR)); return y

def reverb_stereo(buf, rt=1.7, wet=0.22):
    out = np.zeros_like(buf)
    for ch in range(2):
        r = np.random.default_rng(31 + ch); t = t_of(rt * 1.3)
        ir = r.standard_normal(len(t)) * np.exp(-t * 6.9 / rt); ir = lowpass_fft(ir, 4200, 2); ir[:int(0.012 * SR)] *= np.linspace(0, 1, int(0.012 * SR)); ir /= np.sqrt((ir ** 2).sum())
        nfft = 1 << int(np.ceil(np.log2(buf.shape[1] + len(ir))))
        out[ch] = np.fft.irfft(np.fft.rfft(buf[ch], nfft) * np.fft.rfft(ir, nfft), nfft)[: buf.shape[1]]
    return buf * (1 - wet * 0.5) + out * wet * 2.0
def pingpong(buf, time, fb=0.34, mix_=0.5, taps=5):
    out = buf.copy(); d = int(time * SR)
    for k in range(1, taps + 1):
        src = buf * (fb ** k) * mix_
        ch = k % 2  # alternate sides
        sh = d * k
        if sh >= buf.shape[1]: break
        out[ch, sh:] += src[0 if ch == 0 else 1, : buf.shape[1] - sh] * 0.8 + src[1 - ch, : buf.shape[1] - sh] * 0.3
    return out

# interface sounds: small, dry, quiet. Nothing cartoonish.
def ui_tap(f=1500, dur=0.09):
    t = t_of(dur); return (np.sin(2 * np.pi * f * t) * np.exp(-t * 55) * 0.5 + highpass_fft(noise(dur), 2500, 2) * np.exp(-t * 220) * 0.25)
def ui_click(dur=0.07):
    t = t_of(dur); return highpass_fft(noise(dur), 1800, 2) * np.exp(-t * 170) * 0.55 + np.sin(2 * np.pi * 220 * t) * np.exp(-t * 70) * 0.45
def air(dur=0.5, up=True, level=0.5, fc0=500, fc1=6500):
    n = highpass_fft(noise(dur), 250, 2)
    # a smooth sweep: crossfade through three low-pass versions
    a, b, c = lowpass_fft(n, fc0, 2), lowpass_fft(n, (fc0 * fc1) ** 0.5, 2), lowpass_fft(n, fc1, 2)
    t = np.clip(t_of(dur) / dur, 0, 1); k = t if up else 1 - t
    y = np.where(k < 0.5, a * (1 - 2 * k) + b * (2 * k), b * (2 - 2 * k) + c * (2 * k - 1))
    return y * np.sin(np.pi * t) ** 1.5 * level * 0.45
def bloom(dur=0.9, f=330):
    """A soft swell for something appearing: air plus a faint rising tone."""
    t = t_of(dur); tone = np.sin(2 * np.pi * np.cumsum(f * (1 + 0.5 * t / dur)) / SR) * 0.1
    return (air(dur, True, 0.35, 300, 3500) + tone * np.sin(np.pi * t / dur) ** 2)
def ping(f=1760, dur=0.9): return bell(f, dur) * 0.5
def power_down(dur=0.7):
    t = t_of(dur); tone = np.sin(2 * np.pi * np.cumsum(260 * np.exp(-t * 5.5) + 38) / SR) * np.exp(-t * 3.2) * 0.7
    return tone + air(dur, False, 0.45, 300, 4500)
def sub_hit(dur=0.9):
    t = t_of(dur); return np.sin(2 * np.pi * np.cumsum(55 + 85 * np.exp(-t * 18)) / SR) * np.exp(-t * 3.6) * 0.9
def riser(dur=0.6):
    t = t_of(dur); y = air(dur, True, 0.9, 400, 9000) * (t / dur) ** 1.3 + np.sin(2 * np.pi * np.cumsum(180 + 1500 * (t / dur) ** 2) / SR) * 0.1 * (t / dur) ** 1.4
    return y
def sfx_pump(dur=0.8):
    t = t_of(dur); y = (np.sin(2 * np.pi * 95 * t) + 0.5 * np.sin(2 * np.pi * 190 * t) + 0.25 * np.sin(2 * np.pi * 285 * t)) * (1 + 0.15 * np.sin(2 * np.pi * 23 * t))
    return y * np.clip(t / 0.06, 0, 1) * np.clip((dur - t) / 0.12, 0, 1) * 0.2
def sfx_pour(dur=0.9):
    t = t_of(dur); stream = lowpass_fft(highpass_fft(noise(dur), 1500, 2), 4200, 2) * 0.35
    tone = np.sin(2 * np.pi * np.cumsum(500 + 1500 * (t / dur) ** 1.3) / SR) * 0.06 * (1 + np.sin(2 * np.pi * 31 * t))
    b = np.zeros_like(t)
    for _ in range(int(dur * 14)):
        at = rng.uniform(0, dur - 0.08); f0 = rng.uniform(600, 1700); k = int(at * SR); tt = t_of(0.07)
        b[k:k + len(tt)] += np.sin(2 * np.pi * f0 * (1 + 4 * tt) * tt) * np.exp(-tt * 55) * 0.12
    return (stream + tone + b) * np.clip(t / 0.05, 0, 1) * np.clip((dur - t) / 0.2, 0, 1)
def sfx_clink(dur=0.4):
    t = t_of(dur); return (np.sin(2 * np.pi * 3520 * t) * np.exp(-t * 14) + 0.6 * np.sin(2 * np.pi * 5230 * t) * np.exp(-t * 20) + 0.3 * np.sin(2 * np.pi * 7050 * t) * np.exp(-t * 28)) * 0.4
def sfx_steam(dur=2.2): t = t_of(dur); return highpass_fft(noise(dur), 4000, 2) * np.clip(t / 0.3, 0, 1) * np.clip((dur - t) / 0.8, 0, 1) * 0.07
def sfx_sip(dur=0.7):
    t = t_of(dur); n = lowpass_fft(highpass_fft(noise(0.45), 700, 2), 2600, 2) * np.sin(np.pi * np.clip(t_of(0.45) / 0.45, 0, 1)) * 0.3
    out = np.zeros(len(t)); out[: len(n)] += n
    k = int(0.52 * SR); tt = t_of(0.14); out[k:k + len(tt)] += np.sin(2 * np.pi * np.cumsum(180 - 90 * tt / 0.14) / SR) * np.exp(-tt * 22) * 0.4
    return out

# ---------------------------------------------------------------- sound effects, placed from the timeline
A, B, C, D, E = TL["A"], TL["B"], TL["C"], TL["D"], TL["E"]
sfx = np.zeros((2, N))
add(sfx, 0.02, bloom(1.0, 260), 0.5); add(sfx, A["logo"] + 0.0, ping(1568, 1.2), 0.3)
for i, ts in enumerate(A["h1"] + A["h2"]): add(sfx, ts + 0.02, ui_tap(1300 + 90 * i), 0.38, -0.2 if i % 2 else 0.2)
add(sfx, A["swirl"] + 0.0, air(0.6, True, 0.25), 0.7, -0.3)
for i, ts in enumerate(A["slimes"]): add(sfx, ts, bloom(0.6, 220 + 40 * i), 0.6, [-0.5, -0.2, 0.5, 0.0][i])
add(sfx, A["sub1"], ui_tap(1900), 0.35); add(sfx, A["sub2"], ui_tap(2100), 0.3)
add(sfx, A["card"], air(0.4, True, 0.4), 0.7); add(sfx, A["card"] + 0.25, ping(1318, 1.0), 0.4)
add(sfx, A["photo"], ui_tap(1700), 0.4); add(sfx, A["pill"], ui_click(), 0.6); add(sfx, A["pill"] + 0.02, sub_hit(0.6), 0.35)
# he asks for the music to stop
add(sfx, B["in"] - 0.05, power_down(), 0.9)
# the coffee: his machine's own sounds, then the pump and the pour
add(sfx, B["machine"], air(0.4, True, 0.4), 0.6, -0.4); add(sfx, B["machine"] + 0.22, PF_KNOCK_A, 0.9, -0.4)
add(sfx, B["go"], air(0.35, True, 0.2), 0.5, -0.2)
add(sfx, B["lock"], PF_KNOCK_B, 0.9, -0.4)
add(sfx, B["brew"] - 0.1, PF_HISS, 0.8, -0.4)
add(sfx, B["brew"] + 0.05, sfx_pump(0.95), 0.9, -0.4); add(sfx, B["brew"] + 0.2, sfx_pour(0.85), 0.95, -0.3); add(sfx, B["brew"] + 0.3, sfx_steam(1.6), 0.9, -0.3)
add(sfx, B["grab"], sfx_clink(), 0.7, -0.2); add(sfx, B["back"], air(0.4, True, 0.2), 0.5)
add(sfx, B["sip"], sfx_sip(), 0.9); add(sfx, B["sip"] + 0.55, ping(2093, 0.9), 0.25)
add(sfx, B["lower"], sfx_clink(), 0.4)
add(sfx, B["musicBack"] - 0.6, riser(0.6), 0.9); add(sfx, B["musicBack"], sub_hit(), 0.9)
# the app, the mouse
add(sfx, C["in"], air(0.5, True, 0.4), 0.7); add(sfx, C["cursorStart"] + 0.1, air(0.9, True, 0.1, 800, 4000), 0.6)
add(sfx, C["tabClick"], ui_click(), 1.0); add(sfx, C["tabClick"] + 0.05, air(0.25, True, 0.25), 0.5); add(sfx, C["ring"], ping(2093, 0.8), 0.3)
add(sfx, C["cardMove"] + 0.1, air(0.7, True, 0.1, 800, 4000), 0.6)
add(sfx, C["cardClick"], ui_click(), 1.0); add(sfx, C["cardClick"] + 0.06, bloom(0.5, 400), 0.7); add(sfx, C["zoom"], air(0.9, True, 0.4), 0.7)
add(sfx, C["zoom"] + 0.3, ping(1568, 1.0), 0.3); add(sfx, C["out"], air(0.4, True, 0.4), 0.6)
add(sfx, D["in"], bloom(0.6, 300), 0.6); add(sfx, D["inv2"], ui_tap(1500), 0.4); add(sfx, D["apply"], ui_click(), 0.6)
add(sfx, D["url"], ui_tap(2000), 0.35); add(sfx, D["out"], air(0.4, True, 0.4), 0.6)
add(sfx, E["in"], ping(1568, 1.2), 0.3); add(sfx, E["fin1"], ui_tap(1400), 0.45); add(sfx, E["fin2"], ui_tap(1600), 0.45)
add(sfx, E["cta"], ui_click(), 0.7); add(sfx, E["cta"] + 0.02, sub_hit(0.7), 0.45)
add(sfx, E["site"], ui_tap(2000), 0.35)

# ---------------------------------------------------------------- music: warm electronic pad, soft pulse, pluck arpeggio, light drums, 100 BPM
BPM = 100.0; beat = 60.0 / BPM; bar = 4 * beat
CH = [  # Am9, Fmaj7, Cmaj7, G6: pad tones, bass root, arpeggio tones
    ([57, 60, 64, 71], 33, [69, 72, 76, 79]),
    ([53, 57, 60, 64], 29, [65, 69, 72, 76]),
    ([55, 59, 64, 67], 36, [67, 71, 76, 79]),
    ([55, 59, 62, 64], 31, [67, 71, 74, 76]),
]
padbus = np.zeros((2, N)); plbus = np.zeros((2, N)); drums = np.zeros((2, N)); basbus = np.zeros((2, N))
def play(t_from, t_to, arp_level=1.0, drums_from=None, intro=False):
    nb = int((t_to - t_from) / bar) + 1
    for b in range(nb):
        t0 = t_from + b * bar
        if t0 >= t_to: break
        pad_t, root, arp = CH[b % 4]
        d = min(bar + 0.9, t_to - t0 + 0.9)
        add(padbus, t0, pad_chord(pad_t, d, 2400), 0.7 if not intro else 0.65, 0.0)
        for bt, ln in ((0, 0.9), (2.5, 0.5)):
            if t0 + bt * beat < t_to: add(basbus, t0 + bt * beat, sub(note(root + 12), ln), 0.26)
        # arpeggio in 16ths with a gentle accent pattern
        pat = [0, 2, 1, 3, 2, 1, 3, 2, 0, 2, 1, 3, 2, 3, 1, 2]
        vel = [1, .45, .6, .45, .8, .45, .6, .45, 1, .45, .6, .45, .8, .45, .6, .5]
        for s in range(16):
            tt = t0 + s * beat / 4
            if tt >= t_to or tt < (t_from + (0.4 if intro else 0)): continue
            add(plbus, tt, pluck(note(arp[pat[s]]), 0.45), 0.5 * vel[s] * arp_level, -0.35 if s % 2 else 0.35)
        if drums_from is not None and t0 >= drums_from - 0.01 or (drums_from is None):
            for bt in (0, 2):
                if t0 + bt * beat < t_to: add(drums, t0 + bt * beat, kick(), 0.3)
            for bt in (1, 3):
                if t0 + bt * beat < t_to: add(drums, t0 + bt * beat, rim(), 0.8)
            for s in range(16):
                tt = t0 + s * beat / 4
                if tt < t_to: add(drums, tt, hat([1, .35, .6, .35][s % 4]), 1.2, 0.3 if s % 2 else -0.3)
        elif t0 + 0.01 >= t_from:
            pass
play(0.0, B["in"], 1.0, drums_from=1.2, intro=True)                  # the opening: pad swell, pluck, drums join after a beat
END_HIT = V["cut"] + V["o2"] + (V["tail"] - V["cut"]) + 0.2
play(B["musicBack"], END_HIT, 1.0)
# the mid part (the app) steps back a little
def duck_region(buf, a, b, g=0.55):
    i, j = int(a * SR), int(b * SR); buf[:, i:j] *= g
for bus in (plbus, drums): duck_region(bus, C["in"], C["out"], 0.55)
music = padbus * 0.55 + plbus * 0.9 + basbus * 0.9 + drums * 0.8
music = pingpong(music * 1.0, beat * 0.75, 0.38, 0.5)
music = reverb_stereo(music, 1.8, 0.2)
# cut where the music has to stop or end (a short fade so there is no click)
def stop_at(buf, t, fade=0.05, until=None):
    i = int(t * SR); n = int(fade * SR); j = N if until is None else int(until * SR)
    buf[:, i:i + n] *= np.linspace(1, 0, n); buf[:, i + n:j] = 0
stop_at(music, B["in"], 0.35, B["musicBack"] - 0.02)
stop_at(music, END_HIT, 0.05)
# the closing chord, left to ring
fin = np.zeros((2, N))
add(fin, END_HIT, pad_chord([55, 59, 64, 67, 71], 3.0, 2400), 1.0); add(fin, END_HIT, sub(note(36), 2.2), 0.35); add(fin, END_HIT, kick(), 0.3)
for k, m in enumerate([79, 83, 86, 91]): add(fin, END_HIT + 0.02 + k * 0.08, pluck(note(m), 1.6), 0.28)
fin = reverb_stereo(fin, 2.4, 0.3)
music = music + fin * 0.55

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
