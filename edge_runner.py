"""Edge device program: runs the real pipeline on live sensors, or on a simulated worker with --sim.

  python3 kit/edge_runner.py --sim --speed 20 --log session.jsonl        # no hardware needed (tested)
  python3 kit/edge_runner.py --camera 0 --serial /dev/ttyUSB0 --log session.jsonl --dashboard http://<laptop>:5055/api/alerts

Camera: OpenCV + MediaPipe FaceMesh give the 6+6+4 landmarks and an eye crop.
Wristband: the ESP32 sends one JSON line per second: {"hr":72.0,"spo2":98.0,"acc":[50 values]} and accepts the line BUZZ.
Every decision is appended to the log (used by pilot/analyze_pilot.py). Alerts go to the dashboard over HTTP and,
if --mqtt host is given and paho-mqtt is installed, to topic factory/line3/alerts.
The camera and serial parts need real devices and have NOT been run in this build; --sim has.
"""
import argparse, datetime, json, os, pickle, sys, time
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import synth, vision, wearable, fusion

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
R_EYE, L_EYE, MOUTH = [33, 160, 158, 133, 153, 144], [362, 385, 387, 263, 373, 380], [78, 13, 308, 14]


class SimSource:
    """Feeds one simulated worker second by second (same interface as the real sources)."""
    def __init__(self, seed, n_s):
        self.w = synth.demo_session(seed, n_s); self.rng = np.random.default_rng(seed); self.s = 0; self.n = n_s

    def second(self):
        if self.s >= self.n:
            return None
        w, s = self.w, self.s; self.s += 1
        fr = []
        for i in range(s * 10, s * 10 + 10):
            L, R, Mo = synth.landmarks_from(w["ear"][i], w["mar"][i], self.rng)
            fr.append(dict(L=L, R=R, M=Mo, patch=vision.render_eye(w["ear"][i], self.rng), vis=bool(w["face"][i])))
        return fr, float(w["hr"][s]), float(w["spo"][s]), w["acc"][s * 50:(s + 1) * 50]

    def buzz(self, on): pass


class LiveSource:
    """Real camera + ESP32 wristband. Needs: pip install opencv-python mediapipe pyserial"""
    def __init__(self, cam, port):
        import cv2, mediapipe as mp, serial
        self.cv2 = cv2; self.cap = cv2.VideoCapture(cam)
        self.mesh = mp.solutions.face_mesh.FaceMesh(max_num_faces=1, refine_landmarks=True)
        self.ser = serial.Serial(port, 115200, timeout=2); self.last = (70.0, 98.0, np.zeros(50))

    def _frame(self):
        ok, img = self.cap.read()
        if not ok:
            return dict(vis=False, L=np.zeros((6, 2)), R=np.zeros((6, 2)), M=np.zeros((4, 2)), patch=np.zeros((24, 24), np.float32))
        h, w = img.shape[:2]; g = self.cv2.cvtColor(img, self.cv2.COLOR_BGR2GRAY)
        res = self.mesh.process(self.cv2.cvtColor(img, self.cv2.COLOR_BGR2RGB))
        if not res.multi_face_landmarks:
            return dict(vis=False, L=np.zeros((6, 2)), R=np.zeros((6, 2)), M=np.zeros((4, 2)), patch=np.zeros((24, 24), np.float32))
        lm = res.multi_face_landmarks[0].landmark
        pt = lambda ids: np.array([[lm[i].x * w, lm[i].y * h] for i in ids])
        L, R, M = pt(L_EYE), pt(R_EYE), pt(MOUTH)
        x0, y0 = (R.min(0) - 8).astype(int).clip(0); x1, y1 = (R.max(0) + 8).astype(int)
        crop = g[y0:y1, x0:x1]
        crop = self.cv2.resize(crop, (24, 24), interpolation=self.cv2.INTER_AREA).astype(np.float32) if crop.size else np.zeros((24, 24), np.float32)
        return dict(vis=True, L=L, R=R, M=M, patch=(crop - crop.mean()) / (crop.std() + 1e-6))

    def second(self):
        t0 = time.time(); fr = []
        for _ in range(10):
            fr.append(self._frame()); time.sleep(max(0, .1 - (time.time() - t0) % .1))
        try:
            line = self.ser.readline().decode().strip()
            if line:
                d = json.loads(line); self.last = (float(d["hr"]), float(d["spo2"]), np.array(d["acc"], float))
        except Exception:
            pass                                                   # keep the last reading if a line is lost
        return fr, *self.last

    def buzz(self, on):
        if on:
            self.ser.write(b"BUZZ\n")


def send(msg, url, mqtt):
    if url:
        try:
            import requests; requests.post(url, json=msg, timeout=2)
        except Exception as e:
            print("dashboard delivery failed:", e)
    if mqtt:
        try:
            import paho.mqtt.publish as pub; pub.single("factory/line3/alerts", json.dumps(msg), hostname=mqtt)
        except Exception as e:
            print("mqtt delivery failed:", e)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sim", action="store_true"); ap.add_argument("--seed", type=int, default=9001); ap.add_argument("--seconds", type=int, default=300)
    ap.add_argument("--speed", type=float, default=1.0); ap.add_argument("--camera", type=int, default=0); ap.add_argument("--serial")
    ap.add_argument("--log", default="session.jsonl"); ap.add_argument("--dashboard"); ap.add_argument("--mqtt"); ap.add_argument("--worker", default="W-17")
    ap.add_argument("--artifacts", default=os.path.join(ROOT, "artifacts"))
    a = ap.parse_args()
    cnn = vision.EyeCNN(); cnn.load(f"{a.artifacts}/eye_cnn.npz")
    M = pickle.load(open(f"{a.artifacts}/models.pkl", "rb"))
    src = SimSource(a.seed, a.seconds) if a.sim else LiveSource(a.camera, a.serial)
    ear_b, mar_b, cp_b, vis_b, acc_b, hr_b, sp_b = [], [], [], [], [], [], []
    alert = fusion.AlertState(); t0 = time.time(); s = -1
    open(a.log, "w").close()
    while True:
        got = src.second()
        if got is None:
            break
        s += 1; fr, hr, spo, acc = got
        for f in fr:
            ear_b.append((vision.ear(f["L"]) + vision.ear(f["R"])) / 2 if f["vis"] else 0.0)
            mar_b.append(vision.mar(f["M"]) if f["vis"] else 0.0); vis_b.append(f["vis"])
        cp_b.extend(cnn.predict_proba(np.stack([f["patch"] for f in fr]).astype(np.float32)).tolist())
        acc_b.extend(list(acc)); hr_b.append(hr); sp_b.append(spo)
        if s >= 9 and (s - 9) % 5 == 0:
            wa, wb = len(ear_b) - 100, len(ear_b)
            vis = np.array(vis_b[wa:wb]); face_ok = vis.mean() >= .8; pv = None
            if face_ok:
                vf = np.append(vision.vision_features(np.array(cp_b[wa:wb])[vis], np.array(mar_b[wa:wb])[vis]), (np.array(ear_b[wa:wb])[vis] < .2).mean())
                pv = float(M["mv"].predict_proba(vf[None])[0, 1])
            wf = wearable.wearable_features(np.array(hr_b[-10:]), np.array(sp_b[-10:]), np.array(acc_b[-500:]))
            pw = float(M["mw"].predict_proba(wf[None])[0, 1])
            risk = float(M["fus"].prob(pv if face_ok else .5, pw, face_ok)[0]); ev = alert.update(risk)
            rec = dict(t=s + 1, time=datetime.datetime.now().isoformat(timespec="seconds"), pv=pv, pw=round(pw, 4), risk=round(risk, 4),
                       face_ok=bool(face_ok), alert=alert.on, event=ev)
            open(a.log, "a").write(json.dumps(rec) + "\n")
            print(f"t={s + 1:4d}s  vision={'--' if pv is None else f'{pv:.2f}'}  wearable={pw:.2f}  risk={risk:.2f}  {'ALERT' if alert.on else ''} {ev or ''}")
            if ev == "ALERT_ON":
                src.buzz(True)
                send(dict(topic="factory/line3/alerts", worker=a.worker, sim_time_s=s + 1, risk_percent=round(risk * 100), state="FATIGUED",
                          vision_score=None if pv is None else round(pv * 100), wearable_score=round(pw * 100),
                          mode="camera + wearable" if face_ok else "wearable only, camera blocked", actions=["buzz wristband", "notify supervisor"]), a.dashboard, a.mqtt)
            elif ev == "ALERT_OFF":
                send(dict(topic="factory/line3/alerts", worker=a.worker, sim_time_s=s + 1, state="CLEARED", risk_percent=round(risk * 100)), a.dashboard, a.mqtt)
        if a.sim:
            d = t0 + (s + 1) / a.speed - time.time()
            if d > 0: time.sleep(d)


if __name__ == "__main__":
    main()
