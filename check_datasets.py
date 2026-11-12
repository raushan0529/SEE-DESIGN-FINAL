"""Step 0: look at the downloaded datasets and print the exact command to run next.

  python kit/check_datasets.py --mrl C:\\data\\mrl-eye --wearable C:\\data\\mohapatra --yawdd C:\\data\\yawdd
Any of the three options may be left out.
"""
import argparse, glob, os
import pandas as pd


def mrl(root):
    f = glob.glob(os.path.join(root, "**", "*.png"), recursive=True) + glob.glob(os.path.join(root, "**", "*.jpg"), recursive=True)
    ok = [x for x in f if len(os.path.basename(x).split("_")) >= 5 and os.path.basename(x).split("_")[4] in ("0", "1")]
    closed = sum(os.path.basename(x).split("_")[4] == "0" for x in ok)
    subj = {os.path.basename(x).split("_")[0] for x in ok}
    print(f"MRL Eye: {len(f)} images, {len(ok)} with a valid name, {len(subj)} subjects, closed {closed}, open {len(ok) - closed}")
    if ok:
        print(f'  NEXT:  python kit/train_cnn_real.py --data "{root}" --max-per-class 20000 --epochs 7')
    else:
        print("  Nothing usable. Unzip the dataset and point --mrl at the folder that holds the s0001... folders.")


def wearable(root):
    f = [x for x in glob.glob(os.path.join(root, "**", "*.csv"), recursive=True) if "Rep" in os.path.basename(x) or "Rest" in os.path.basename(x)]
    print(f"Mohapatra wearable data: {len(f)} processed Rep/Rest CSV files")
    if not f:
        print("  None found. Unzip the dataset and point --wearable at the folder that holds Task Harnessing / Task Composite.")
        return
    df = pd.read_csv(f[0], nrows=3)
    need = ["HR_Processed", "HRV", "Temperature", "acc_X", "IMU_1_ax_g_", "Physical Fatigue - Final"]
    print("  first file:", f[0]); print("  columns found:", len(df.columns), " missing needed:", [c for c in need if c not in df.columns] or "none")
    print("  Participants:", len({os.path.basename(x).split("_")[-1][:4] for x in f}))
    print(f'  NEXT 1:  python kit/train_wearable_mohapatra.py --data "{root}" --show-labels   (see the fatigue values)')
    print(f'  NEXT 2:  python kit/train_wearable_mohapatra.py --data "{root}" --threshold 4   (pick a threshold giving both classes a fair share)')


def yawdd(root):
    v = glob.glob(os.path.join(root, "**", "*.avi"), recursive=True) + glob.glob(os.path.join(root, "**", "*.mp4"), recursive=True)
    print(f"YawDD: {len(v)} videos found. Used to test yawn (MAR) detection on real faces.")
    if v:
        print(f'  NEXT:  python kit/test_yawdd.py --data "{root}" --max-videos 20')


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    for k in ("mrl", "wearable", "yawdd"):
        ap.add_argument("--" + k)
    a = ap.parse_args()
    if a.mrl: mrl(a.mrl)
    if a.wearable: wearable(a.wearable)
    if a.yawdd: yawdd(a.yawdd)
