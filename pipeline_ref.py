"""The Python reference pipeline used by the backend to verify the browser. Same code that produced the website data."""
import os, sys, json, pickle, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import synth, vision, wearable, fusion

ART = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'artifacts')


def load_models():
    M = pickle.load(open(f'{ART}/models.pkl', 'rb'))
    cnn = vision.EyeCNN(); cnn.load(f'{ART}/eye_cnn.npz')
    return M, cnn


def flatten_xgb(model):
    b = model.get_booster()
    cfg = json.loads(b.save_config())
    bs = cfg['learner']['learner_model_param']['base_score']
    base = float(re.findall(r'[-+0-9.eE]+', str(bs))[0])
    F, T, L, R, V, roots = [], [], [], [], [], []
    for dump in b.get_dump(dump_format='json'):
        t = json.loads(dump); nodes = {}
        def walk(n):
            nodes[n['nodeid']] = n
            for c in n.get('children', []): walk(c)
        walk(t)
        ids = sorted(nodes); off = len(F); idx = {nid: off + i for i, nid in enumerate(ids)}
        roots.append(off)
        for nid in ids:
            n = nodes[nid]
            if 'leaf' in n:
                F.append(-1); T.append(0.0); L.append(-1); R.append(-1); V.append(float(n['leaf']))
            else:
                F.append(int(n['split'][1:])); T.append(float(n['split_condition']))
                L.append(idx[n['yes']]); R.append(idx[n['no']]); V.append(0.0)
    return dict(base=base, roots=roots, f=F, t=T, l=L, r=R, v=V)


def eval_xgb(m, x):
    x = np.float32(x); tot = np.log(m['base'] / (1 - m['base']))
    for r in m['roots']:
        n = r
        while m['f'][n] >= 0:
            n = m['l'][n] if x[m['f'][n]] < np.float32(m['t'][n]) else m['r'][n]
        tot += m['v'][n]
    return 1 / (1 + np.exp(-tot))


MASK = np.uint64(0xFFFFFFFF)
PATCH_SCALE = 8.0
NOISE_SD = 0.12


def noise_matrix(seed, n_frames):
    """Camera sensor noise, generated the same way in the browser (mulberry32 + Box-Muller, seeded per frame)."""
    i = np.arange(n_frames, dtype=np.uint64)
    a = (np.uint64(seed) * np.uint64(1000003) + i * np.uint64(7919)) & MASK
    U = np.empty((n_frames, 576))
    for k in range(576):
        a = (a + np.uint64(0x6D2B79F5)) & MASK
        t = ((a ^ (a >> np.uint64(15))) * (np.uint64(1) | a)) & MASK
        t = (((t + (((t ^ (t >> np.uint64(7))) * (np.uint64(61) | t)) & MASK)) & MASK) ^ t)
        U[:, k] = ((t ^ (t >> np.uint64(14))) & MASK) / 4294967296.0
    u1 = np.maximum(U[:, 0::2], 1e-12); u2 = U[:, 1::2]
    r = np.sqrt(-2 * np.log(u1))
    Z = np.empty_like(U); Z[:, 0::2] = r * np.cos(2 * np.pi * u2); Z[:, 1::2] = r * np.sin(2 * np.pi * u2)
    return Z


def quantise_session(w, seed):
    """Per-frame landmark coordinates + eye patches, exactly as the camera module would see them."""
    rng = np.random.default_rng(seed)
    nf = len(w['ear'])
    lm = np.empty((nf, 32), np.int16); pt = np.empty((nf, 576), np.int8)
    for i in range(nf):
        L, R, Mo = synth.landmarks_from(w['ear'][i], w['mar'][i], rng)
        lm[i] = np.round(np.concatenate([L.ravel(), R.ravel(), Mo.ravel()]) * 100).astype(np.int16)
        pt[i] = np.clip(np.round(vision.render_eye(w['ear'][i], rng, noise=False).ravel() * PATCH_SCALE), -127, 127).astype(np.int8)
    return dict(
        lm=lm, patches=pt, seed=seed, face=w['face'].astype(np.uint8),
        hr=np.round(w['hr'] * 10).astype(np.int16), spo=np.round(w['spo'] * 100).astype(np.int16),
        acc=np.clip(np.round(w['acc'] * 1000), -32000, 32000).astype(np.int16),
        truth=np.round(np.clip(w['f'], 0, 1) * 255).astype(np.uint8))


def reference(q, M, cnn):
    """Python reference decisions computed from the quantised data (what the browser must reproduce)."""
    nf = len(q['face']); n_s = nf // 10
    lm = q['lm'].astype(np.float64) / 100
    ear_lm = np.empty(nf); mar_lm = np.empty(nf)
    for i in range(nf):
        L = lm[i, 0:12].reshape(6, 2); R = lm[i, 12:24].reshape(6, 2); Mo = lm[i, 24:32].reshape(4, 2)
        ear_lm[i] = (vision.ear(L) + vision.ear(R)) / 2; mar_lm[i] = vision.mar(Mo)
    patches = (q['patches'].astype(np.float64) / PATCH_SCALE + NOISE_SD * noise_matrix(q['seed'], nf)).astype(np.float32).reshape(nf, 24, 24)
    cp = cnn.predict_proba(patches)
    hr = q['hr'] / 10.0; spo = q['spo'] / 100.0; acc = q['acc'] / 1000.0
    al = fusion.AlertState(); out = []
    for s in range(9, n_s):
        if (s - 9) % 5: continue
        a, b = (s - 9) * 10, (s + 1) * 10
        vis = q['face'][a:b].astype(bool); ok = vis.mean() >= .8; pv = None; vf = None
        if ok:
            vf = np.append(vision.vision_features(cp[a:b][vis], mar_lm[a:b][vis]), (ear_lm[a:b][vis] < .2).mean())
            pv = float(eval_xgb(M['mv'].flat, vf))
        wf = wearable.wearable_features(hr[s - 9:s + 1], spo[s - 9:s + 1], acc[(s - 9) * 50:(s + 1) * 50])
        pw = float(eval_xgb(M['mw'].flat, wf))
        risk = float(M['fus'].prob(pv if ok else .5, pw, ok)[0])
        ev = al.update(risk)
        out.append(dict(s=s, ok=bool(ok), pv=pv, pw=pw, risk=risk, alert=al.on, ev=ev,
                        vf=None if vf is None else vf.tolist(), wf=wf.tolist()))
    return out, cp


_cache = {}


def load_all():
    """Models once per process, with the flattened tree form the reference evaluator needs."""
    if "m" not in _cache:
        M, cnn = load_models()
        for k in ("mv", "mw"):
            M[k].flat = flatten_xgb(M[k])
        _cache["m"] = (M, cnn)
    return _cache["m"]


