"""Adds 12 more simulated workers (W-113 ... W-124) to the website data, making 24 in total.

  python build_workers24.py --frontend ../frontend

It simulates each worker (synth.py), turns the signals into the same integer format the website reads,
runs the Python reference pipeline on them (pipeline_ref.py) and appends everything to
frontend/data/blob.js, manifest.js and refc.js. Running it twice does nothing the second time.
"""
import argparse, base64, gzip, json, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import synth, pipeline_ref as P

N_S = 240
t = np.arange(N_S)


def curve(points):
    f = np.interp(t, [p[0] for p in points], [p[1] for p in points])
    return np.clip(np.convolve(f, np.ones(9) / 9, "same"), 0, 1)


def face(hidden=()):
    fv = np.ones(N_S, bool)
    for a, b in hidden: fv[a:b] = False
    return fv


# id, name, role, station, seed, fatigue story, hidden-face stretches
NEW = [
    ("W-113", "Vikram Rao", "Machine operator", "Line 4", 7201, [(0, .10), (40, .15), (90, .85), (239, .9)], ()),
    ("W-114", "Neha Verma", "Packer", "Line 3", 7202, [(0, .10), (239, .13)], ()),
    ("W-115", "Imran Sheikh", "Forklift driver", "Warehouse", 7203, [(0, .10), (130, .15), (170, .80), (239, .85)], ()),
    ("W-116", "Deepa Menon", "Quality inspector", "Line 2", 7204, [(0, .10), (60, .20), (110, .85), (239, .9)], ((100, 185),)),
    ("W-117", "Harish Chandra", "Crane operator", "Yard", 7205, [(0, .10), (60, .30), (110, .85), (140, .85), (175, .20), (239, .15)], ()),
    ("W-118", "Pooja Iyer", "Assembler", "Line 4", 7206, [(0, .10), (120, .35), (239, .45)], ()),
    ("W-119", "Rahul Deshmukh", "Welder", "Fabrication", 7207, [(0, .12), (80, .18), (150, .82), (239, .88)], ((20, 70),)),
    ("W-120", "Sana Qureshi", "Machine operator", "Line 1", 7208, [(0, .10), (100, .55), (200, .88), (239, .9)], ()),
    ("W-121", "Gurpreet Singh", "Loader", "Warehouse", 7209, [(0, .10), (55, .80), (110, .20), (170, .85), (239, .85)], ()),
    ("W-122", "Anjali Pillai", "Packer", "Line 4", 7210, [(0, .10), (239, .15)], ((60, 100),)),
    ("W-123", "Manoj Tiwari", "Press operator", "Line 1", 7211, [(0, .65), (60, .75), (239, .85)], ()),
    ("W-124", "Rekha Das", "Quality inspector", "Line 3", 7212, [(0, .10), (120, .20), (170, .85), (239, .9)], ((190, 239),)),
]

LAYOUT = [("lm", "int16"), ("hr", "int16"), ("spo", "int16"), ("acc", "int16"), ("face", "uint8"), ("truth", "uint8"), ("patches", "int8")]


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--frontend", required=True); a = ap.parse_args()
    D = os.path.join(a.frontend, "data")
    rd = lambda n: json.loads(json.loads(open(f"{D}/{n}.js", encoding="utf8").read().split("=", 2)[2].rstrip(";\n")))
    man = rd("manifest")
    if any(m["id"] == NEW[0][0] for m in man): print("already 24 workers"); return
    ref = rd("refc")
    raw = gzip.decompress(base64.b64decode(json.loads(open(f"{D}/blob.js", encoding="utf8").read().split("=", 2)[2].rstrip(";\n"))))
    M, cnn = P.load_all()
    chunks = [raw]; off = len(raw)
    for wid, name, role, st, seed, pts, hid in NEW:
        w = synth.make_worker(seed, n_s=N_S, occlusions=False, f_override=curve(pts), face_override=face(hid))
        w["label_bias"] = 0.0
        q = P.quantise_session(w, seed)
        out, _ = P.reference(q, M, cnn)
        ref[wid] = [[o["s"], round(o["risk"], 7), o["ev"]] for o in out]
        e = dict(id=wid, name=name, role=role, station=st, seed=seed, n_s=N_S)
        for k, typ in LAYOUT:
            arr = np.ascontiguousarray(q[k]).ravel(); b = arr.tobytes()
            e[k] = [off, int(arr.size), typ]; chunks.append(b); off += len(b)
        man.append(e)
        print(wid, name, "alerts:", sum(1 for o in out if o["ev"] == "ALERT_ON"), "max risk %.2f" % max(o["risk"] for o in out))
    blob = base64.b64encode(gzip.compress(b"".join(chunks), 6)).decode()
    wr = lambda n, v: open(f"{D}/{n}.js", "w", encoding="utf8").write("window.FM_DATA=window.FM_DATA||{};window.FM_DATA.%s=%s;\n" % (n, json.dumps(json.dumps(v) if n != "blob" else v)))
    wr("manifest", man); wr("refc", ref); wr("blob", blob)
    print("workers now:", len(man), " blob MB:", round(len(blob) / 1e6, 1))


if __name__ == "__main__":
    main()
