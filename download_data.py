"""Download all three real datasets with one command (run on YOUR laptop, needs internet).

  pip install kagglehub requests
  python kit/download_data.py --out data            (all three)
  python kit/download_data.py --out data --only mrl  (or: wearable, yawdd)

Kaggle needs a free account: kaggle.com -> Settings -> API -> Create New Token, then save kaggle.json to
C:\\Users\\<you>\\.kaggle\\kaggle.json   (kagglehub reads it).  YawDD is 5 GB.
Prints the exact check_datasets.py command at the end.
"""
import argparse, os, shutil, sys, zipfile


def kaggle(handle, dest):
    import kagglehub
    p = kagglehub.dataset_download(handle)
    shutil.copytree(p, dest, dirs_exist_ok=True); return dest


def zenodo(record, dest):
    import requests
    os.makedirs(dest, exist_ok=True)
    info = requests.get(f"https://zenodo.org/api/records/{record}", timeout=60).json()
    for f in info["files"]:
        name = f.get("key") or f.get("filename"); url = f["links"]["self"]
        out = os.path.join(dest, name); print("downloading", name, f.get("size", ""))
        with requests.get(url, stream=True, timeout=60) as r, open(out, "wb") as fh:
            shutil.copyfileobj(r.raw, fh)
        if name.lower().endswith(".zip"):
            zipfile.ZipFile(out).extractall(dest)
    return dest


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("--out", default="data"); ap.add_argument("--only", choices=["mrl", "wearable", "yawdd"])
    a = ap.parse_args(); got = {}
    if a.only in (None, "mrl"): got["mrl"] = kaggle("imadeddinedjerarda/mrl-eye-dataset", os.path.join(a.out, "mrl"))
    if a.only in (None, "wearable"): got["wearable"] = zenodo("12788571", os.path.join(a.out, "mohapatra"))
    if a.only in (None, "yawdd"): got["yawdd"] = kaggle("enider/yawdd-dataset", os.path.join(a.out, "yawdd"))
    print("\nNEXT:  python kit/check_datasets.py " + " ".join(f'--{k} "{v}"' for k, v in got.items()))
