# Sound for the phone teaser: vibration, notification tones, the lift, the reveal, a soft pad. Reads the same timeline as the picture.
import json, subprocess, sys, numpy as np, wave
SR = 48000
CFG = sys.argv[1] if len(sys.argv) > 1 else "teaser.json"
OUT = sys.argv[2] if len(sys.argv) > 2 else "out/mix.wav"
T = json.load(open(CFG))["timeline"]
N = int(T["total"] * SR)
L = np.zeros(N); R = np.zeros(N)
rng = np.random.default_rng(7)

def put(sig, at, gain=1.0, pan=0.0):
    i = int(at * SR)
    if i >= N: return
    sig = sig[: N - i] * gain
    L[i:i + len(sig)] += sig * (1 - max(0, pan)); R[i:i + len(sig)] += sig * (1 + min(0, pan))

def tt(d): return np.arange(int(d * SR)) / SR
def lowpass(x, a):
    y = np.zeros_like(x); acc = 0.0
    for i, v in enumerate(x): acc += a * (v - acc); y[i] = acc
    return y
def fade(x, a=0.01, r=0.03):
    n = len(x); e = np.ones(n); na, nr = int(a * SR), int(r * SR)
    e[:na] = np.linspace(0, 1, na); e[-nr:] = np.linspace(1, 0, nr); return x * e

def buzz(d):  # a phone vibrating on a stone table
    t = tt(d)
    motor = np.tanh(3 * np.sin(2 * np.pi * 172 * t)) * 0.5 + 0.2 * np.sin(2 * np.pi * 344 * t)
    rattle = rng.standard_normal(len(t)); rattle = rattle - lowpass(rattle, 0.25)
    rattle *= (np.sin(2 * np.pi * 172 * t) > 0.6) * 0.35
    return fade(lowpass(motor, 0.35) + rattle * 0.5, 0.012, 0.05)

def tone(f, d, dec=6.0, harm=0.25):
    t = tt(d); return fade((np.sin(2 * np.pi * f * t) + harm * np.sin(2 * np.pi * 2 * f * t)) * np.exp(-dec * t), 0.003, 0.05)

def whoosh(d, up=True):
    t = tt(d); n = rng.standard_normal(len(t)); out = np.zeros(len(t)); acc = 0.0
    for i in range(len(t)):
        p = i / len(t); a = 0.02 + 0.3 * (p if up else 1 - p) ** 2
        acc += a * (n[i] - acc); out[i] = acc
    return out * np.sin(np.pi * np.arange(len(t)) / len(t)) ** 1.5

def boom(d=1.6):
    t = tt(d); f = 46 + 50 * np.exp(-9 * t)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-2.6 * t)

def pad(notes, d, a=1.2, r=1.5):
    t = tt(d); x = np.zeros(len(t))
    for k, f in enumerate(notes):
        for det in (-0.35, 0.35):
            x += np.sin(2 * np.pi * (f + det) * t + k) + 0.3 * np.sin(2 * np.pi * 2 * (f + det) * t)
    x = lowpass(x / len(notes), 0.08)
    e = np.minimum(1, t / a) * np.minimum(1, (d - t) / r)
    return x * e

# room tone under the footage
room = lowpass(rng.standard_normal(N), 0.012) * 2.2
put(room, 0, 0.5)
# the message arrives
put(buzz(0.30), T["on"], 0.55); put(buzz(0.30), T["on"] + 0.42, 0.55)
put(tone(1318.5, 0.5, 7), T["banner"], 0.30); put(tone(1760.0, 0.7, 5.5), T["banner"] + 0.11, 0.28)
# it lifts out of the glass
put(whoosh(0.7), T["lift"] - 0.05, 0.9); put(tone(523.25, 0.9, 4, 0.1), T["lift"] + 0.45, 0.22); put(boom(0.6), T["lift"] + 0.45, 0.25)
# second message
put(buzz(0.22), T["msg2"] - 0.05, 0.4); put(tone(1568.0, 0.5, 7), T["msg2"] + 0.12, 0.26); put(tone(2093.0, 0.6, 6), T["msg2"] + 0.22, 0.2)
# the reveal
put(whoosh(0.9), T["dim"] - 0.55, 1.1); put(boom(), T["flip"], 0.85); put(whoosh(0.35, False), T["flip"] + 0.05, 0.5)
put(tone(880.0, 1.2, 3, 0.15), T["flip"] + 0.42, 0.16)
put(boom(1.2), T["line2"], 0.6); put(tone(1174.7, 1.6, 2.5, 0.2), T["line2"] + 0.02, 0.2); put(tone(1760.0, 1.6, 2.5, 0.2), T["line2"] + 0.02, 0.12)
D = [146.83, 220.0, 293.66, 349.23, 440.0]; F = [174.61, 261.63, 349.23, 440.0, 523.25]
put(pad(D, min(T["end"], T["total"]) - T["dim"] + 0.8, 1.0, 1.2), T["dim"], 0.5)
if T["end"] < T["total"]: put(pad(F, T["total"] - T["end"], 0.6, 1.6), T["end"], 0.55)
put(whoosh(0.5), T["end"] - 0.35, 0.5)
for k, f in enumerate([698.46, 880.0, 1046.5]): put(tone(f, 1.8, 2.2, 0.15), T["end"] + 0.25 + 0.14 * k, 0.16, pan=(k - 1) * 0.3)

st = np.stack([L, R], 1); st /= max(1e-9, np.abs(st).max()) * 1.1
end = int(0.5 * SR); st[-end:] *= np.linspace(1, 0, end)[:, None]
with wave.open("out/raw.wav", "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((st * 32767).astype("<i2").tobytes())
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", "out/raw.wav", "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", "48000", OUT], check=True)
print(OUT)
