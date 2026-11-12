"""
Worker Fatigue Monitor: backend (Flask + SQLite), one file.

Run:      pip install flask
          python backend.py                 -> http://127.0.0.1:5055/api/health
Self-test: python backend.py --test         -> runs the checks below and exits

What it does
  * keeps workers, readings, alerts and an audit log in SQLite (file: fatigue.db)
  * receives one reading per worker every 5 s from the edge pipeline  (POST /api/readings)
  * raises an alert when risk >= 55% for 2 checks in a row, clears it below 45%
    (the edge may also send its own "ev": "ALERT_ON" / "ALERT_OFF"; if it does, that is used)
  * lets the supervisor acknowledge and close alerts, and writes everything to the audit log
  * answers the same requests the dashboard website uses (see ROUTES at the bottom)

Optional: set API_KEY=secret to require the header  X-API-Key: secret  on every POST.
Sensor data is simulated in this project; this file does not care where readings come from.
"""
import csv, io, os, sqlite3, sys, threading, time
from flask import Flask, g, jsonify, request

DB_PATH = os.environ.get("FATIGUE_DB", os.path.join(os.path.dirname(os.path.abspath(__file__)), "fatigue.db"))
API_KEY = os.environ.get("API_KEY", "")
ALERT_ON, ALERT_OFF, NEED = 0.55, 0.45, 2          # same rule as the edge pipeline
LOCK = threading.Lock()
app = Flask(__name__)

SEED_WORKERS = [
    ("W-101", "Ravi Kumar", "Press operator", "Line 1"),
    ("W-102", "Anita Sharma", "Assembler", "Line 1"),
    ("W-103", "Mohammed Irfan", "Forklift driver", "Warehouse"),
    ("W-104", "Sunita Patil", "Quality inspector", "Line 2"),
    ("W-105", "Joseph Mathew", "Welder", "Fabrication"),
    ("W-106", "Lakshmi Nair", "Packer", "Line 3"),
    ("W-107", "Arjun Singh", "Crane operator", "Yard"),
    ("W-108", "Priya Reddy", "Assembler", "Line 2"),
    ("W-109", "Dinesh Gupta", "Machine operator", "Line 3"),
    ("W-110", "Fatima Khan", "Quality inspector", "Line 1"),
    ("W-111", "Suresh Babu", "Loader", "Warehouse"),
    ("W-112", "Kavita Joshi", "Welder", "Fabrication"),
    ("W-113", "Vikram Rao", "Machine operator", "Line 4"),
    ("W-114", "Neha Verma", "Packer", "Line 3"),
    ("W-115", "Imran Sheikh", "Forklift driver", "Warehouse"),
    ("W-116", "Deepa Menon", "Quality inspector", "Line 2"),
    ("W-117", "Harish Chandra", "Crane operator", "Yard"),
    ("W-118", "Pooja Iyer", "Assembler", "Line 4"),
    ("W-119", "Rahul Deshmukh", "Welder", "Fabrication"),
    ("W-120", "Sana Qureshi", "Machine operator", "Line 1"),
    ("W-121", "Gurpreet Singh", "Loader", "Warehouse"),
    ("W-122", "Anjali Pillai", "Packer", "Line 4"),
    ("W-123", "Manoj Tiwari", "Press operator", "Line 1"),
    ("W-124", "Rekha Das", "Quality inspector", "Line 3"),
]

SCHEMA = """
CREATE TABLE IF NOT EXISTS workers(id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT, station TEXT,
    streak INTEGER DEFAULT 0, alert_on INTEGER DEFAULT 0, break_ordered INTEGER DEFAULT 0, tampered INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS readings(id INTEGER PRIMARY KEY AUTOINCREMENT, worker TEXT NOT NULL REFERENCES workers(id),
    s INTEGER NOT NULL, risk REAL NOT NULL, pv REAL, pw REAL, ok INTEGER, alert INTEGER, hr REAL, spo2 REAL, created REAL);
CREATE INDEX IF NOT EXISTS ix_readings_worker ON readings(worker, s);
CREATE TABLE IF NOT EXISTS alerts(id TEXT PRIMARY KEY, worker TEXT NOT NULL REFERENCES workers(id), t INTEGER, status TEXT,
    basis TEXT, risk REAL, peak REAL, cleared INTEGER, ack_by TEXT, ack_t INTEGER, closed_t INTEGER, outcome TEXT);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT, t INTEGER, who TEXT, what TEXT, ref TEXT, created REAL);
"""


# ----------------------------------------------------------------------------- database helpers
def db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys=ON")
    return g.db


@app.teardown_appcontext
def _close(_):
    d = g.pop("db", None)
    if d is not None:
        d.close()


def init_db(seed=True):
    c = sqlite3.connect(DB_PATH)
    c.executescript(SCHEMA)
    if seed and not c.execute("SELECT 1 FROM workers LIMIT 1").fetchone():
        c.executemany("INSERT INTO workers(id,name,role,station) VALUES(?,?,?,?)", SEED_WORKERS)
    c.commit(); c.close()


def fmt(s):
    return "%02d:%02d" % (int(s) // 60, int(s) % 60) if s is not None else ""


def err(code, msg):
    return jsonify(error=msg), code


def audit(who, what, ref, t):
    db().execute("INSERT INTO audit(t,who,what,ref,created) VALUES(?,?,?,?,?)", (t, who, what, ref, time.time()))


def last_t():
    r = db().execute("SELECT MAX(s) m FROM readings").fetchone()
    return r["m"] if r["m"] is not None else 0


def status_of(w, last):
    if not last: return "starting"
    if last["alert"]: return "alert"
    return "watch" if last["risk"] >= ALERT_OFF else "normal"


def worker_json(w):
    last = db().execute("SELECT * FROM readings WHERE worker=? ORDER BY s DESC, id DESC LIMIT 1", (w["id"],)).fetchone()
    spark = [r["risk"] for r in db().execute("SELECT risk FROM readings WHERE worker=? ORDER BY s DESC, id DESC LIMIT 20", (w["id"],))][::-1]
    n = db().execute("SELECT COUNT(*) c FROM alerts WHERE worker=?", (w["id"],)).fetchone()["c"]
    return dict(id=w["id"], name=w["name"], role=w["role"], station=w["station"], status=status_of(w, last),
                risk=last["risk"] if last else None, camera=None if not last else ("ok" if last["ok"] else "blind"),
                hr=last["hr"] if last else None, spo2=last["spo2"] if last else None, alerts=n,
                breakOrdered=bool(w["break_ordered"]), tampered=bool(w["tampered"]), spark=spark)


def alert_json(a):
    w = db().execute("SELECT name,role,station FROM workers WHERE id=?", (a["worker"],)).fetchone()
    return dict(id=a["id"], worker=a["worker"], name=w["name"], role=w["role"], station=w["station"], t=a["t"], status=a["status"],
                basis=a["basis"], risk=a["risk"], peak=a["peak"], cleared=a["cleared"], ackBy=a["ack_by"], ackT=a["ack_t"],
                closedT=a["closed_t"], outcome=a["outcome"])


@app.before_request
def _auth():
    if request.method == "POST" and API_KEY and request.headers.get("X-API-Key") != API_KEY:
        return err(401, "Missing or wrong X-API-Key")


@app.after_request
def _cors(r):                                    # lets a dashboard served from another address call this API
    r.headers["Access-Control-Allow-Origin"] = "*"
    r.headers["Access-Control-Allow-Headers"] = "Content-Type, X-API-Key"
    return r


# ----------------------------------------------------------------------------- routes
@app.get("/api/health")
def health():
    n = db().execute("SELECT COUNT(*) c FROM workers").fetchone()["c"]
    return jsonify(ok=True, service="fatigue-monitor-api", workers=n, shift_time=last_t())


@app.get("/api/workers")
def workers():
    return jsonify([worker_json(w) for w in db().execute("SELECT * FROM workers ORDER BY id")])


@app.post("/api/workers")
def add_worker():
    b = request.get_json(silent=True) or {}
    if not all(isinstance(b.get(k), str) and b[k].strip() for k in ("id", "name")):
        return err(422, "id and name are required text")
    try:
        db().execute("INSERT INTO workers(id,name,role,station) VALUES(?,?,?,?)", (b["id"], b["name"], b.get("role", ""), b.get("station", "")))
        db().commit()
    except sqlite3.IntegrityError:
        return err(409, "Worker %s already exists" % b["id"])
    return jsonify(id=b["id"]), 201


@app.get("/api/workers/<wid>")
def worker(wid):
    w = db().execute("SELECT * FROM workers WHERE id=?", (wid,)).fetchone()
    if not w: return err(404, "Unknown worker " + wid)
    o = worker_json(w)
    o["series"] = [dict(s=r["s"], risk=r["risk"], pv=r["pv"], pw=r["pw"], ok=bool(r["ok"]), alert=bool(r["alert"]), hr=r["hr"], spo=r["spo2"])
                   for r in db().execute("SELECT * FROM readings WHERE worker=? ORDER BY s, id", (wid,))]
    o["alert_list"] = [alert_json(a) for a in db().execute("SELECT * FROM alerts WHERE worker=? ORDER BY t", (wid,))]
    return jsonify(o)


@app.post("/api/workers/<wid>/camera")
def camera(wid):
    b = request.get_json(silent=True) or {}
    w = db().execute("SELECT * FROM workers WHERE id=?", (wid,)).fetchone()
    if not w: return err(404, "Unknown worker " + wid)
    if not isinstance(b.get("covered"), bool): return err(422, "covered must be true or false")
    if b["covered"]: db().execute("UPDATE workers SET tampered=1 WHERE id=?", (wid,))
    audit("Supervisor", "covered the camera (test)" if b["covered"] else "uncovered the camera", wid, last_t())
    db().commit()
    return jsonify(worker=wid, covered=b["covered"])


@app.post("/api/readings")
def readings():
    """One reading from the edge pipeline: worker, s (seconds into shift), risk 0..1, optional pv, pw, ok, hr, spo, ev."""
    b = request.get_json(silent=True) or {}
    with LOCK:
        w = db().execute("SELECT * FROM workers WHERE id=?", (b.get("worker"),)).fetchone()
        if not w: return err(404, "Unknown worker %s" % b.get("worker"))
        s, risk = b.get("s"), b.get("risk")
        if not isinstance(s, int) or isinstance(s, bool) or s < 0: return err(422, "s must be a whole number of seconds")
        if isinstance(risk, bool) or not isinstance(risk, (int, float)) or not 0 <= risk <= 1: return err(422, "risk must be a number between 0 and 1")
        ok = 1 if b.get("ok", True) else 0
        ev = b.get("ev")
        if ev not in (None, "ALERT_ON", "ALERT_OFF"): return err(422, "ev must be ALERT_ON, ALERT_OFF or missing")
        streak, on = w["streak"], bool(w["alert_on"])
        if ev is None:                                        # backend applies the rule itself: 2 in a row on, below 45% off
            if not on:
                streak = streak + 1 if risk >= ALERT_ON else 0
                if streak >= NEED: ev = "ALERT_ON"
            elif risk < ALERT_OFF:
                ev = "ALERT_OFF"
        if ev == "ALERT_ON": on, streak = True, 0
        elif ev == "ALERT_OFF": on, streak = False, 0
        db().execute("UPDATE workers SET streak=?, alert_on=? WHERE id=?", (streak, int(on), w["id"]))
        db().execute("INSERT INTO readings(worker,s,risk,pv,pw,ok,alert,hr,spo2,created) VALUES(?,?,?,?,?,?,?,?,?,?)",
                     (w["id"], s, risk, b.get("pv"), b.get("pw"), ok, int(on), b.get("hr"), b.get("spo"), time.time()))
        new_id = None
        open_a = db().execute("SELECT * FROM alerts WHERE worker=? AND cleared IS NULL", (w["id"],)).fetchone()
        if ev == "ALERT_ON" and not open_a:
            n = db().execute("SELECT COUNT(*) c FROM alerts").fetchone()["c"] + 1
            new_id = "A-%03d" % n
            db().execute("INSERT INTO alerts(id,worker,t,status,basis,risk,peak) VALUES(?,?,?,?,?,?,?)",
                         (new_id, w["id"], s, "open", "Camera + wristband" if ok else "Wristband only (camera blind)", risk, risk))
            audit("System", "raised alert for " + w["name"], new_id, s)
        elif open_a:
            db().execute("UPDATE alerts SET peak=MAX(peak,?) WHERE id=?", (risk, open_a["id"]))
            if ev == "ALERT_OFF":
                db().execute("UPDATE alerts SET cleared=? WHERE id=?", (s, open_a["id"]))
                audit("System", "risk dropped below the clear line for " + w["name"], open_a["id"], s)
        db().commit()
    return jsonify(stored=True, event=ev, alert=new_id), 201


@app.get("/api/alerts")
def alerts():
    q, args = "SELECT * FROM alerts", []
    if request.args.get("status"):
        q += " WHERE status=?"; args.append(request.args["status"])
    return jsonify([alert_json(a) for a in db().execute(q + " ORDER BY t DESC, id DESC", args)])


def _alert_action(aid, fn):
    a = db().execute("SELECT * FROM alerts WHERE id=?", (aid,)).fetchone()
    if not a: return err(404, "Unknown alert " + aid)
    if a["status"] == "resolved": return err(409, "Alert %s is already closed" % aid)
    return fn(a)


@app.post("/api/alerts/<aid>/ack")
def ack(aid):
    b = request.get_json(silent=True) or {}
    def go(a):
        if a["status"] != "open": return err(409, "Alert %s is already acknowledged" % aid)
        who, t = str(b.get("by") or "Supervisor"), last_t()
        db().execute("UPDATE alerts SET status='acknowledged', ack_by=?, ack_t=? WHERE id=?", (who, t, aid))
        audit(who, "acknowledged the alert", aid, t); db().commit()
        return jsonify(alert_json(db().execute("SELECT * FROM alerts WHERE id=?", (aid,)).fetchone()))
    return _alert_action(aid, go)


@app.post("/api/alerts/<aid>/resolve")
def resolve(aid):
    b = request.get_json(silent=True) or {}
    def go(a):
        outcome = str(b.get("outcome") or "").strip()
        if not outcome: return err(422, "outcome is required")
        t = last_t(); who = a["ack_by"] or str(b.get("by") or "Supervisor")
        if a["status"] == "open":
            db().execute("UPDATE alerts SET ack_by=?, ack_t=? WHERE id=?", (who, t, aid))
        db().execute("UPDATE alerts SET status='resolved', closed_t=?, outcome=? WHERE id=?", (t, outcome, aid))
        if b.get("break"): db().execute("UPDATE workers SET break_ordered=1 WHERE id=?", (a["worker"],))
        audit(who, "closed the alert: " + outcome, aid, t); db().commit()
        return jsonify(alert_json(db().execute("SELECT * FROM alerts WHERE id=?", (aid,)).fetchone()))
    return _alert_action(aid, go)


@app.get("/api/stats")
def stats():
    ws = [worker_json(w) for w in db().execute("SELECT * FROM workers")]
    st = {"normal": 0, "watch": 0, "alert": 0, "starting": 0}
    for w in ws: st[w["status"]] += 1
    c = lambda q: db().execute(q).fetchone()[0]
    mean = db().execute("SELECT AVG(ack_t - t) FROM alerts WHERE ack_t IS NOT NULL").fetchone()[0]
    return jsonify(workers=len(ws), status=st, camera_blind=sum(1 for w in ws if w["camera"] == "blind"),
                   alerts_total=c("SELECT COUNT(*) FROM alerts"), alerts_open=c("SELECT COUNT(*) FROM alerts WHERE status='open'"),
                   alerts_active=c("SELECT COUNT(*) FROM alerts WHERE status!='resolved'"), mean_ack_delay_s=mean,
                   readings=c("SELECT COUNT(*) FROM readings"), shift_time=last_t())


@app.get("/api/audit")
def audit_log():
    return jsonify([dict(t=r["t"], who=r["who"], what=r["what"], ref=r["ref"]) for r in db().execute("SELECT * FROM audit ORDER BY id DESC LIMIT 60")])


@app.get("/api/report")
def report():
    out = io.StringIO(); wr = csv.writer(out)
    wr.writerow(["alert", "worker", "name", "station", "raised_at", "basis", "peak_risk", "cleared_at", "status", "acknowledged_by", "outcome"])
    for a in db().execute("SELECT a.*, w.name, w.station FROM alerts a JOIN workers w ON w.id=a.worker ORDER BY a.t"):
        wr.writerow([a["id"], a["worker"], a["name"], a["station"], fmt(a["t"]), a["basis"], "%.3f" % a["peak"], fmt(a["cleared"]),
                     a["status"], a["ack_by"] or "", a["outcome"] or ""])
    return jsonify(csv=out.getvalue().strip())


@app.post("/api/reset")
def reset():                                    # start a new shift: clears readings, alerts and the audit log, keeps the workers
    c = db()
    for t in ("readings", "alerts", "audit"): c.execute("DELETE FROM " + t)
    c.execute("UPDATE workers SET streak=0, alert_on=0, break_ordered=0, tampered=0")
    c.commit()
    return jsonify(ok=True)


@app.errorhandler(404)
def _nf(_):
    return err(404, "No such route: %s %s" % (request.method, request.path))


@app.errorhandler(405)
def _na(_):
    return err(405, "Method not allowed")


# ----------------------------------------------------------------------------- self-test
def self_test():
    global DB_PATH
    DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_selftest.db")
    if os.path.exists(DB_PATH): os.remove(DB_PATH)
    init_db(); c = app.test_client(); n = [0]
    def check(name, cond):
        n[0] += 1; print(("PASS " if cond else "FAIL ") + name)
        if not cond: sys.exit(1)
    R = lambda s, risk, w="W-101", **k: c.post("/api/readings", json=dict(worker=w, s=s, risk=risk, **k))
    check("health lists 24 seeded workers", c.get("/api/health").json["workers"] == 24)
    check("unknown worker -> 404", R(9, .5, w="X-1").status_code == 404)
    check("risk 1.5 -> 422", R(9, 1.5).status_code == 422)
    check("risk text -> 422", R(9, "high").status_code == 422)
    check("s negative -> 422", R(-1, .5).status_code == 422)
    r1 = R(9, .60); check("one high reading does not alert", r1.json["alert"] is None)
    r2 = R(14, .70, ok=False); check("second high reading raises alert A-001", r2.json["alert"] == "A-001" and r2.json["event"] == "ALERT_ON")
    check("alert basis says wristband only when camera blind", c.get("/api/alerts").json[0]["basis"].startswith("Wristband only"))
    check("worker status is alert", c.get("/api/workers/W-101").json["status"] == "alert")
    R(19, .50); check("risk 50% keeps the alert on (clear line is 45%)", c.get("/api/workers/W-101").json["status"] == "alert")
    r3 = R(24, .30); check("risk below 45% clears the alert", r3.json["event"] == "ALERT_OFF" and c.get("/api/alerts").json[0]["cleared"] == 24)
    check("peak risk stored", abs(c.get("/api/alerts").json[0]["peak"] - .70) < 1e-9)
    R(9, .60, w="W-102", ev="ALERT_ON"); check("edge-sent ALERT_ON is respected", c.get("/api/workers/W-102").json["status"] == "alert")
    check("ack ok", c.post("/api/alerts/A-001/ack", json={"by": "Supervisor"}).status_code == 200)
    check("ack twice -> 409", c.post("/api/alerts/A-001/ack", json={}).status_code == 409)
    check("resolve without outcome -> 422", c.post("/api/alerts/A-001/resolve", json={}).status_code == 422)
    check("resolve with break", c.post("/api/alerts/A-001/resolve", json={"outcome": "Break given", "break": True}).json["status"] == "resolved")
    check("resolve twice -> 409", c.post("/api/alerts/A-001/resolve", json={"outcome": "x"}).status_code == 409)
    check("break flag set on worker", c.get("/api/workers/W-101").json["breakOrdered"] is True)
    check("unknown alert -> 404", c.post("/api/alerts/A-999/ack", json={}).status_code == 404)
    check("camera needs boolean -> 422", c.post("/api/workers/W-101/camera", json={"covered": "yes"}).status_code == 422)
    check("stats count alerts", c.get("/api/stats").json["alerts_total"] == 2)
    check("audit log has entries", len(c.get("/api/audit").json) >= 5)
    check("report is CSV with a header", c.get("/api/report").json["csv"].startswith("alert,worker"))
    check("duplicate worker -> 409", c.post("/api/workers", json={"id": "W-101", "name": "Dup"}).status_code == 409)
    check("new worker -> 201", c.post("/api/workers", json={"id": "W-125", "name": "New Worker"}).status_code == 201)
    check("reset clears alerts", c.post("/api/reset").status_code == 200 and c.get("/api/stats").json["alerts_total"] == 0)
    check("bad route -> 404 JSON", c.get("/api/nothing").status_code == 404)
    os.remove(DB_PATH); print("\nAll %d checks passed." % n[0])


if __name__ == "__main__":
    if "--test" in sys.argv:
        self_test()
    else:
        init_db()
        port = int(os.environ.get("PORT", 5055))
        print("Fatigue Monitor API on http://127.0.0.1:%d/api/health  (database: %s)" % (port, DB_PATH))
        app.run(host="127.0.0.1", port=port, debug=False)
