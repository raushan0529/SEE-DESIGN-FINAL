"""Time the edge pipeline. Run it on the Raspberry Pi to fill in the 'timed on Raspberry Pi' item.

  python3 kit/bench_edge.py            # prints a table and writes bench_result.json
The decision window is 10 s of data and a new decision is due every 5 s, so the pipeline must finish one
window's work in well under 5 s. 'Real-time margin' = 5 s divided by the measured time per decision.
"""
import json, os, pickle, platform, sys, time
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import synth, vision, wearable

root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
cnn = vision.EyeCNN(); cnn.load(os.path.join(root, "artifacts/eye_cnn.npz"))
M = pickle.load(open(os.path.join(root, "artifacts/models.pkl"), "rb"))
w = synth.demo_session(9001)
rng = np.random.default_rng(0)
patches = np.stack([vision.render_eye(w["ear"][i], rng) for i in range(100)]).astype(np.float32)
lm = [synth.landmarks_from(w["ear"][i], w["mar"][i], rng) for i in range(100)]
cp = cnn.predict_proba(patches); mar_v = np.array([vision.mar(m[2]) for m in lm]); ear_v = np.array([(vision.ear(l) + vision.ear(r)) / 2 for l, r, _ in lm])
hr, spo, acc = w["hr"][:10], w["spo"][:10], w["acc"][:500]


def best(fn, n=15):
    fn()
    t = []
    for _ in range(n):
        a = time.perf_counter(); fn(); t.append(time.perf_counter() - a)
    return float(np.median(t)) * 1000


vf = np.append(vision.vision_features(cp, mar_v), (ear_v < .2).mean()); wf = wearable.wearable_features(hr, spo, acc)
st = {
    "Landmarks to EAR/MAR (100 frames)": best(lambda: [(vision.ear(l), vision.ear(r), vision.mar(m)) for l, r, m in lm]),
    "Eye-state CNN (100 frames)": best(lambda: cnn.predict_proba(patches)),
    "Vision features": best(lambda: vision.vision_features(cp, mar_v)),
    "Vision XGBoost": best(lambda: M["mv"].predict_proba(vf[None])),
    "Wearable features (PSD, 500 samples)": best(lambda: wearable.wearable_features(hr, spo, acc)),
    "Wearable XGBoost": best(lambda: M["mw"].predict_proba(wf[None])),
    "Fusion": best(lambda: M["fus"].prob(.7, .6, True)),
}
total = sum(st.values())
for k, v in st.items():
    print(f"{k:40s} {v:8.2f} ms")
print(f"{'Total per decision':40s} {total:8.2f} ms   real-time margin {5000 / total:.0f}x (needs > 1)")
try:
    cpu = [l.split(":")[1].strip() for l in open("/proc/cpuinfo") if l.startswith(("model name", "Model"))][0]
except Exception:
    cpu = platform.processor()
json.dump(dict(device=cpu, machine=platform.machine(), cores=os.cpu_count(), stages_ms={k: round(v, 2) for k, v in st.items()},
               total_ms=round(total, 2), realtime_margin=round(5000 / total, 1)), open("bench_result.json", "w"), indent=1)
