"""Train the wearable fatigue model on the REAL Mohapatra et al. dataset (Northwestern / Boeing / Deere),
"Wearable Network for Multi-Level Physical Fatigue Prediction in Manufacturing Workers".

What the dataset really contains (from its README and Resampler_segmenter.m)
  * per participant and session: processed files  Rep1..Rep5_<id>.csv, Initial_Rest_<id>.csv, Final_Rest_<id>.csv
  * every row is one sample every 500 ms (2 Hz). Columns include
      Time (ms), HR_Processed, HR, HRV, RR, ECG, acc_X/Y/Z (chest), Temperature, IMU_1..5 (ax,ay,az,gx,gy,gz),
      Physical Fatigue - Initial / Final, Mental Fatigue - Initial / Final, Performance rating, Age, Weight, Height, Weights added
  * there is NO SpO2 column, and 2 Hz is too slow for the 0.1-12 Hz power spectrum of our simulated wristband.
    So this script uses features that exist at 2 Hz: heart rate level / spread / slope, HRV, skin temperature,
    and movement activity from the chest and 5 IMUs.
  * the fatigue label is a self-reported rating per repetition ("Physical Fatigue - Final").

Evaluation is leave-one-participant-out (GroupKFold), so the score is on people never seen in training.

  python kit/train_wearable_mohapatra.py --data "C:\\data\\mohapatra" --threshold 4
Run once with --show-labels first to see the label values and pick a threshold that gives both classes a fair share.
Writes artifacts_real/wearable_metrics.json and artifacts_real/wearable_model.pkl
"""
import argparse, glob, json, os, pickle, re
import numpy as np, pandas as pd
import xgboost as xgb
from sklearn.model_selection import GroupKFold
from sklearn.metrics import accuracy_score, recall_score, precision_score, f1_score, roc_auc_score

WIN, STEP = 40, 20                       # 20 s windows, new window every 10 s (samples are 0.5 s apart)
LABEL = "Physical Fatigue - Final"


def find_files(root):
    fs = glob.glob(os.path.join(root, "**", "*.csv"), recursive=True)
    keep = [f for f in fs if re.search(r"(Rep\d|Initial_Rest|Final_Rest)", os.path.basename(f), re.I)]
    return sorted(f for f in keep if "raw" not in [x.lower() for x in f.split(os.sep)])


def participant(name):
    m = re.search(r"P(\d{2,3})", os.path.basename(name)); return m.group(1) if m else os.path.basename(name)


def mag(df, cols):
    cols = [c for c in cols if c in df.columns]
    return np.sqrt((df[cols].astype(float) ** 2).sum(axis=1)).to_numpy() if cols else np.zeros(len(df))


def feats(d):
    hr = d["HR_Processed"].to_numpy(float) if "HR_Processed" in d else d["HR"].to_numpy(float)
    hrv = d["HRV"].to_numpy(float) if "HRV" in d else np.zeros(len(d))
    tmp = d["Temperature"].to_numpy(float) if "Temperature" in d else np.zeros(len(d))
    t = np.arange(len(d)) * 0.5
    acc = mag(d, ["acc_X", "acc_Y", "acc_Z"])
    imu_a = np.mean([mag(d, [f"IMU_{i}_ax_g_", f"IMU_{i}_ay_g_", f"IMU_{i}_az_g_"]) for i in range(1, 6)], axis=0)
    imu_g = np.mean([mag(d, [f"IMU_{i}_gx_dps_", f"IMU_{i}_gy_dps_", f"IMU_{i}_gz_dps_"]) for i in range(1, 6)], axis=0)
    slope = lambda y: float(np.polyfit(t, y, 1)[0]) if np.std(y) > 0 else 0.0
    return [np.nanmean(hr), np.nanstd(hr), slope(np.nan_to_num(hr)), np.nanmean(hrv), np.nanstd(hrv),
            np.nanmean(tmp), slope(np.nan_to_num(tmp)), np.nanstd(acc), np.nanmean(np.abs(np.diff(acc))),
            np.nanstd(imu_a), np.nanmean(imu_g), np.nanstd(imu_g)]


NAMES = ["hr_mean", "hr_std", "hr_slope", "hrv_mean", "hrv_std", "temp_mean", "temp_slope", "acc_std", "acc_jerk",
         "imu_acc_std", "imu_gyro_mean", "imu_gyro_std"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True); ap.add_argument("--threshold", type=float, default=4)
    ap.add_argument("--show-labels", action="store_true"); ap.add_argument("--out", default="artifacts_real")
    a = ap.parse_args()
    files = find_files(a.data)
    if not files: raise SystemExit("No Rep*/Rest CSV files found under " + a.data + ". Point --data at the unzipped dataset folder.")
    X, y, G, raw = [], [], [], []
    for f in files:
        df = pd.read_csv(f)
        if LABEL not in df.columns: continue
        pid = participant(f)
        raw.append((pid, float(df[LABEL].iloc[0])))
        for s in range(0, len(df) - WIN + 1, STEP):
            w = df.iloc[s:s + WIN]
            X.append(feats(w)); y.append(float(w[LABEL].mean())); G.append(pid)
    X, y, G = np.nan_to_num(np.array(X)), np.array(y), np.array(G)
    print(f"{len(files)} files, {len(X)} windows, {len(set(G))} participants")
    vals, cnt = np.unique(np.round(y), return_counts=True)
    print("label values (rounded) and window counts:", dict(zip(vals.tolist(), cnt.tolist())))
    if a.show_labels: return
    yb = (y >= a.threshold).astype(int)
    print(f"threshold {a.threshold}: fatigued share {yb.mean():.2f}")
    if yb.min() == yb.max(): raise SystemExit("Only one class at this threshold. Choose another with --threshold.")
    gbm = lambda: xgb.XGBClassifier(n_estimators=160, max_depth=3, learning_rate=.08, subsample=.9, colsample_bytree=.9, eval_metric="logloss", n_jobs=2)
    oof = np.zeros(len(yb))
    for tr, te in GroupKFold(min(5, len(set(G)))).split(X, yb, G):
        oof[te] = gbm().fit(X[tr], yb[tr]).predict_proba(X[te])[:, 1]
    yh = (oof >= .5).astype(int)
    base = max(yb.mean(), 1 - yb.mean())
    res = dict(files=len(files), windows=int(len(yb)), participants=int(len(set(G))), threshold=a.threshold,
               fatigued_share=round(float(yb.mean()), 3), majority_baseline=round(float(base), 3),
               accuracy=round(accuracy_score(yb, yh), 4), recall=round(recall_score(yb, yh), 4),
               precision=round(precision_score(yb, yh, zero_division=0), 4), f1=round(f1_score(yb, yh), 4),
               auc=round(roc_auc_score(yb, oof), 4), features=NAMES, sensor_note="2 Hz processed data, no SpO2; features differ from the 50 Hz simulated wristband")
    res["data_source"] = "sample" if os.path.exists(os.path.join(a.data, "SAMPLE_DATA.txt")) else "real"
    m = gbm().fit(X, yb); res["top_features"] = [NAMES[i] for i in np.argsort(-m.feature_importances_)[:4]]
    os.makedirs(a.out, exist_ok=True); pickle.dump(m, open(f"{a.out}/wearable_model.pkl", "wb"))
    json.dump(res, open(f"{a.out}/wearable_metrics.json", "w"), indent=1); print(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
