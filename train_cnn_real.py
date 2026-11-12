"""Train the eye-state CNN on the real MRL Eye dataset (replaces the drawn-eye training data).

Download MRL Eye from https://www.kaggle.com/datasets/imadeddinedjerarda/mrl-eye-dataset and unzip it.
File names look like  s0001_00001_0_0_0_0_0_01.png  ->  subject, image, gender, glasses, EYE STATE (0 closed, 1 open), ...
The split is BY SUBJECT, so the test accuracy is on people the network never saw.

  python3 kit/train_cnn_real.py --data /path/to/mrl-eye --max-per-class 20000
Writes artifacts_real/eye_cnn.npz and artifacts_real/cnn_metrics.json (the live site and server keep using artifacts/).
"""
import argparse, glob, json, os, sys
import numpy as np, cv2
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import vision


def load(root, max_per_class, seed=0):
    files = glob.glob(os.path.join(root, "**", "*.png"), recursive=True) + glob.glob(os.path.join(root, "**", "*.jpg"), recursive=True)
    rows = []
    for f in files:
        p = os.path.basename(f).split("_")
        if len(p) >= 5 and p[4] in ("0", "1"):
            rows.append((f, p[0], 1 - int(p[4])))         # label 1 = closed, as in vision.py
        else:                                             # fallback: folders called "closed"/"open"
            d = f.lower().replace("\\", "/")
            if "/closed" in d or "close" in d: rows.append((f, os.path.basename(os.path.dirname(f)), 1))
            elif "/open" in d: rows.append((f, os.path.basename(os.path.dirname(f)), 0))
    if not rows:
        sys.exit("No MRL-style file names found under " + root)
    rng = np.random.default_rng(seed)
    out = []
    for c in (0, 1):
        r = [x for x in rows if x[2] == c]
        rng.shuffle(r)
        out += r[:max_per_class]
    X, y, g = [], [], []
    for f, s, lab in out:
        im = cv2.imread(f, cv2.IMREAD_GRAYSCALE)
        if im is None:
            continue
        im = cv2.resize(im, (24, 24), interpolation=cv2.INTER_AREA).astype(np.float32)
        X.append((im - im.mean()) / (im.std() + 1e-6)); y.append(lab); g.append(s)
    return np.stack(X), np.array(y), np.array(g)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True); ap.add_argument("--max-per-class", type=int, default=20000)
    ap.add_argument("--epochs", type=int, default=7); ap.add_argument("--out", default="artifacts_real")
    a = ap.parse_args()
    X, y, g = load(a.data, a.max_per_class)
    subs = np.unique(g); rng = np.random.default_rng(1); rng.shuffle(subs)
    test_s = set(subs[:max(1, len(subs) // 5)])
    te = np.array([s in test_s for s in g]); tr = ~te
    print(f"{len(X)} images, {len(subs)} subjects; train {tr.sum()} / test {te.sum()} (test subjects unseen)")
    cnn = vision.EyeCNN(0)
    rng = np.random.default_rng(2)
    Xt = X[tr] + rng.normal(0, .0, X[tr].shape)          # real images already carry their own noise
    cnn.fit(Xt, y[tr], epochs=a.epochs)
    pr = cnn.predict_proba(X[te])
    acc = float(((pr > .5) == y[te]).mean())
    tp = int(((pr > .5) & (y[te] == 1)).sum()); fn = int(((pr <= .5) & (y[te] == 1)).sum())
    res = dict(images=len(X), subjects=int(len(subs)), test_images=int(te.sum()), heldout_subject_accuracy=round(acc, 4),
               closed_eye_recall=round(tp / max(1, tp + fn), 4))
    res["data_source"] = "sample" if os.path.exists(os.path.join(a.data, "SAMPLE_DATA.txt")) else "real"
    os.makedirs(a.out, exist_ok=True); cnn.save(f"{a.out}/eye_cnn.npz")
    json.dump(res, open(f"{a.out}/cnn_metrics.json", "w"), indent=1); print(res)


if __name__ == "__main__":
    main()
