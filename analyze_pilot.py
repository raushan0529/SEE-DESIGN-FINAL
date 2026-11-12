"""Compare the edge device logs with the volunteers' Borg ratings.

  python3 pilot/analyze_pilot.py --logs pilot/logs --ratings pilot/ratings.csv
logs/P01.jsonl ... come from edge_runner.py. ratings.csv columns: participant, minute, borg_6_to_20
(minute = minutes since the start of the task). A Borg rating of 13 or more counts as fatigued (--threshold).
"""
import argparse, glob, json, os
import numpy as np, pandas as pd


def analyze(logs, ratings, thr=13):
    rows, per = [], []
    for f in sorted(glob.glob(os.path.join(logs, "*.jsonl"))):
        p = os.path.basename(f).split(".")[0]
        L = pd.DataFrame([json.loads(l) for l in open(f) if l.strip()])
        R = ratings[ratings.participant == p].dropna(subset=["borg_6_to_20"])
        if L.empty or R.empty:
            continue
        miss = fa = tp = tn = 0
        for _, r in R.iterrows():
            t = r.minute * 60
            w = L[(L.t > t - 150) & (L.t <= t + 150)]               # decisions within 2.5 min of the rating
            if w.empty:
                continue
            said, flagged = r.borg_6_to_20 >= thr, bool((w.risk >= .55).any())
            tp += said and flagged; miss += said and not flagged; fa += (not said) and flagged; tn += (not said) and not flagged
        first = R[R.borg_6_to_20 >= thr].minute.min()
        alerts = L[L.event == "ALERT_ON"].t
        lat = None if np.isnan(first) or alerts.empty else float(alerts[alerts >= 0].min() - first * 60)
        per.append(dict(participant=p, ratings=len(R), tp=int(tp), missed=int(miss), false_alarms=int(fa), tn=int(tn),
                        agreement=round((tp + tn) / max(1, tp + tn + miss + fa), 3), camera_blind_share=round(float((~L.face_ok).mean()), 3),
                        seconds_from_first_tired_rating_to_alert=lat))
    df = pd.DataFrame(per)
    if df.empty:
        return df, {}
    tp, m, fa, tn = df.tp.sum(), df.missed.sum(), df.false_alarms.sum(), df.tn.sum()
    tot = dict(participants=len(df), agreement=round(float((tp + tn) / max(1, tp + tn + m + fa)), 3), missed_fatigue_rate=round(float(m / max(1, tp + m)), 3),
               false_alarm_rate=round(float(fa / max(1, fa + tn)), 3))
    return df, tot


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("--logs", required=True); ap.add_argument("--ratings", required=True); ap.add_argument("--threshold", type=float, default=13)
    a = ap.parse_args()
    df, tot = analyze(a.logs, pd.read_csv(a.ratings), a.threshold)
    print(df.to_string(index=False)); print(tot); json.dump(tot, open("pilot_summary.json", "w"), indent=1)
