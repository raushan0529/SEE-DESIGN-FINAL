"""All people named in the Worker Fatigue Monitor, in one place.

  python people.py            prints the roster and writes workers.csv, workers.json and team.csv here

WORKERS are fictional, made up for the simulation (no real person). TEAM are the project members.
The same 24 workers appear in: frontend/data/manifest.js, backend/backend.py (SEED_WORKERS),
edge/build_workers24.py (W-113 ... W-124).  `python people.py --check` confirms they all agree.
"""
import csv, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))

# id, name, role, station, simulation seed
WORKERS = [
    ('W-101', 'Ravi Kumar', 'Press operator', 'Line 1', 9001),
    ('W-102', 'Anita Sharma', 'Assembler', 'Line 1', 7013),
    ('W-103', 'Mohammed Irfan', 'Forklift driver', 'Warehouse', 7036),
    ('W-104', 'Sunita Patil', 'Quality inspector', 'Line 2', 7100),
    ('W-105', 'Joseph Mathew', 'Welder', 'Fabrication', 7105),
    ('W-106', 'Lakshmi Nair', 'Packer', 'Line 3', 7106),
    ('W-107', 'Arjun Singh', 'Crane operator', 'Yard', 7022),
    ('W-108', 'Priya Reddy', 'Assembler', 'Line 2', 7021),
    ('W-109', 'Dinesh Gupta', 'Machine operator', 'Line 3', 7109),
    ('W-110', 'Fatima Khan', 'Quality inspector', 'Line 1', 7108),
    ('W-111', 'Suresh Babu', 'Loader', 'Warehouse', 7018),
    ('W-112', 'Kavita Joshi', 'Welder', 'Fabrication', 7029),
    ('W-113', 'Vikram Rao', 'Machine operator', 'Line 4', 7201),
    ('W-114', 'Neha Verma', 'Packer', 'Line 3', 7202),
    ('W-115', 'Imran Sheikh', 'Forklift driver', 'Warehouse', 7203),
    ('W-116', 'Deepa Menon', 'Quality inspector', 'Line 2', 7204),
    ('W-117', 'Harish Chandra', 'Crane operator', 'Yard', 7205),
    ('W-118', 'Pooja Iyer', 'Assembler', 'Line 4', 7206),
    ('W-119', 'Rahul Deshmukh', 'Welder', 'Fabrication', 7207),
    ('W-120', 'Sana Qureshi', 'Machine operator', 'Line 1', 7208),
    ('W-121', 'Gurpreet Singh', 'Loader', 'Warehouse', 7209),
    ('W-122', 'Anjali Pillai', 'Packer', 'Line 4', 7210),
    ('W-123', 'Manoj Tiwari', 'Press operator', 'Line 1', 7211),
    ('W-124', 'Rekha Das', 'Quality inspector', 'Line 3', 7212),
]

# name, role in the project, student ID
TEAM = [
    ("Vanlalliana Saiawi", "Team leader", "2411021060576"),
    ("Raushan Kumar", "Member", "2411021060581"),
    ("Aritra Sen", "Member", "2411021060578"),
    ("Mohammad Abdul Ahmed Shariff", "Member", "2411021060676"),
]
MENTOR = "Dr. Shreenidhi H S"
SUPERVISOR = "Supervisor"          # the dashboard user who acknowledges and closes alerts (a role, not a named person)


def write():
    with open(os.path.join(HERE, "workers.csv"), "w", newline="") as f:
        w = csv.writer(f); w.writerow(["id", "name", "role", "station", "simulation_seed"]); w.writerows(WORKERS)
    json.dump([dict(id=a, name=b, role=c, station=d, seed=e) for a, b, c, d, e in WORKERS], open(os.path.join(HERE, "workers.json"), "w"), indent=1)
    with open(os.path.join(HERE, "team.csv"), "w", newline="") as f:
        w = csv.writer(f); w.writerow(["name", "role", "student_id"]); w.writerows(TEAM)


def check():
    root = os.path.join(HERE, "..")
    ok = True
    man = open(os.path.join(root, "frontend", "data", "manifest.js"), encoding="utf8").read()
    man = json.loads(json.loads(man.split("=", 2)[2].rstrip(";\n")))
    ok &= [(m["id"], m["name"], m["role"], m["station"]) for m in man] == [w[:4] for w in WORKERS]
    be = open(os.path.join(root, "backend", "backend.py"), encoding="utf8").read()
    ids = re.findall(r'\("(W-\d+)", "([^"]+)", "([^"]+)", "([^"]+)"\)', be.split("SEED_WORKERS")[1].split("SCHEMA")[0])
    ok &= ids == [w[:4] for w in WORKERS]
    print("website data, backend and people.py agree" if ok else "MISMATCH between people.py, website data and backend")
    return ok


if __name__ == "__main__":
    if "--check" in sys.argv:
        sys.exit(0 if check() else 1)
    write()
    print("%d workers, %d team members, mentor %s" % (len(WORKERS), len(TEAM), MENTOR))
    for w in WORKERS: print("  %s  %-18s %-18s %s" % w[:4])
