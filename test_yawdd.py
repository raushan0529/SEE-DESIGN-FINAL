"""Check the yawn rule (MAR) on real faces from YawDD.  Needs:  pip install mediapipe opencv-python numpy

YawDD file names contain the label: ...-Yawning.avi, ...-Talking.avi, ...-Normal.avi
For each video we find the longest run of frames with MAR above a threshold; a video counts as "yawn" when
that run lasts at least 1 s. We sweep thresholds and print the best one and its accuracy.

  python kit/test_yawdd.py --data C:\\data\\yawdd --max-videos 30
Writes artifacts_real/yawdd_metrics.json
"""
import argparse, glob, json, os, sys
import numpy as np, cv2
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import vision

LEFT, RIGHT, TOP, BOTTOM = 61, 291, 13, 14          # MediaPipe FaceMesh inner-lip points


def mar_series(path, step=3):
    import mediapipe as mp
    fm = mp.solutions.face_mesh.FaceMesh(static_image_mode=False, max_num_faces=1)
    cap = cv2.VideoCapture(path); fps = cap.get(cv2.CAP_PROP_FPS) or 30
    out, i = [], 0
    while True:
        ok, fr = cap.read()
        if not ok: break
        i += 1
        if i % step: continue
        r = fm.process(cv2.cvtColor(fr, cv2.COLOR_BGR2RGB))
        if r.multi_face_landmarks:
            lm = r.multi_face_landmarks[0].landmark
            pts = np.array([[lm[k].x, lm[k].y] for k in (LEFT, TOP, RIGHT, BOTTOM)])
            out.append(vision.mar(pts))
        else:
            out.append(np.nan)
    return np.array(out), fps / step


def longest_run_s(m, thr, rate):
    best = run = 0
    for v in m > thr:
        run = run + 1 if v else 0; best = max(best, run)
    return best / rate


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--data", required=True)
    ap.add_argument("--max-videos", type=int, default=30); ap.add_argument("--out", default="artifacts_real")
    a = ap.parse_args()
    vids = sorted(glob.glob(os.path.join(a.data, "**", "*.avi"), recursive=True) + glob.glob(os.path.join(a.data, "**", "*.mp4"), recursive=True))
    rows = []
    for v in vids[:a.max_videos]:
        name = os.path.basename(v).lower()
        lab = 1 if "yawn" in name else 0 if ("normal" in name or "talk" in name) else None
        if lab is None: continue
        m, rate = mar_series(v); rows.append((lab, m, rate)); print(os.path.basename(v), "yawn" if lab else "no yawn", f"max MAR {np.nanmax(m):.2f}")
    if not rows: sys.exit("No labelled videos found")
    y = np.array([r[0] for r in rows]); best = (0, 0)
    for thr in np.arange(.2, 1.0, .05):
        pred = np.array([longest_run_s(np.nan_to_num(m), thr, rate) >= 1.0 for _, m, rate in rows])
        acc = float((pred == y).mean())
        if acc > best[0]: best = (acc, float(thr))
    res = dict(videos=len(rows), yawn_videos=int(y.sum()), best_threshold=round(best[1], 2), accuracy=round(best[0], 3))
    os.makedirs(a.out, exist_ok=True); json.dump(res, open(f"{a.out}/yawdd_metrics.json", "w"), indent=1); print(res)


if __name__ == "__main__":
    main()
