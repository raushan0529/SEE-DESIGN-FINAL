"""Make SMALL SAMPLE datasets in the same file format as MRL Eye and Mohapatra, so the training scripts can be
shown running end to end when the real downloads are not available.

  python kit/make_sample_data.py --out sample_data
  python kit/train_cnn_real.py --data sample_data/mrl_sample --max-per-class 500 --out artifacts_sample
  python kit/train_wearable_mohapatra.py --data sample_data/mohapatra_sample --threshold 4 --out artifacts_sample

THE DATA IS MADE UP (drawn eyes, generated heart-rate curves). Results from it are NOT real-data results.
Each folder contains SAMPLE_DATA.txt, so the metrics files say "data_source": "sample" and the website
labels them SAMPLE and does not tick the real-data checklist items.
YawDD is not sampled: it needs real face videos.
"""
import argparse, os
import numpy as np, cv2, pandas as pd

NOTE = "SAMPLE DATA made by make_sample_data.py. Not a real dataset. Results from it must not be reported as real-data results.\n"


def eye(rng, closed, light):
    im = np.full((80, 80), 150 + light, np.float32)
    cv2.ellipse(im, (40, 40), (30, 16), 0, 0, 360, 190 + light, -1)          # eyelid / skin area
    if closed:
        cv2.line(im, (12, 42), (68, 42), 50, 3)                               # closed lid line
    else:
        cv2.ellipse(im, (40, 40), (24, 12), 0, 0, 360, 235, -1)               # white
        cv2.circle(im, (40 + int(rng.integers(-4, 5)), 40), 9, 40, -1)        # iris
        cv2.circle(im, (40, 40), 4, 5, -1)                                    # pupil
    im = cv2.GaussianBlur(im, (3, 3), 0) + rng.normal(0, 8, im.shape)
    return np.clip(im, 0, 255).astype(np.uint8)


def mrl(out, subjects=14, per=24, seed=0):
    rng = np.random.default_rng(seed); os.makedirs(out, exist_ok=True)
    for s in range(1, subjects + 1):
        light = int(rng.integers(-40, 30))
        for i in range(per):
            closed = i % 2
            name = f"s{s:04d}_{i + 1:05d}_{s % 2}_{int(rng.integers(0, 2))}_{0 if closed else 1}_0_0_01.png"
            cv2.imwrite(os.path.join(out, name), eye(rng, closed, light))
    open(os.path.join(out, "SAMPLE_DATA.txt"), "w").write(NOTE)


def mohapatra(out, people=10, seed=1):
    rng = np.random.default_rng(seed); os.makedirs(out, exist_ok=True)
    for p in range(1, people + 1):
        base = rng.uniform(65, 80)
        for rep, fat in ((1, 2), (2, 4), (3, 6), (4, 7)):
            n = 120; t = np.arange(n) * 500.0
            hr = base + 4 * fat + rng.normal(0, 1.5, n).cumsum() * 0.2 + np.linspace(0, 2 * fat, n)
            d = {"Time (ms)": t, "HR_Processed": hr, "HR": hr + rng.normal(0, 1, n),
                 "HRV": np.clip(60 - 5 * fat + rng.normal(0, 4, n), 5, None), "Temperature": 33 + 0.12 * fat + rng.normal(0, .05, n)}
            for ax in "XYZ": d[f"acc_{ax}"] = rng.normal(0, .05 + .01 * fat, n)
            for i in range(1, 6):
                for k in ("ax_g_", "ay_g_", "az_g_"): d[f"IMU_{i}_{k}"] = rng.normal(0, .2 + .03 * fat, n)
                for k in ("gx_dps_", "gy_dps_", "gz_dps_"): d[f"IMU_{i}_{k}"] = rng.normal(0, 20 + 4 * fat, n)
            d["Physical Fatigue - Final"] = np.full(n, fat + rng.integers(-1, 2))
            pd.DataFrame(d).to_csv(os.path.join(out, f"Rep{rep}_P{p:02d}.csv"), index=False)
    open(os.path.join(out, "SAMPLE_DATA.txt"), "w").write(NOTE)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("--out", default="sample_data"); a = ap.parse_args()
    mrl(os.path.join(a.out, "mrl_sample")); mohapatra(os.path.join(a.out, "mohapatra_sample"))
    print("Sample data written to", a.out)
