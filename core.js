/* Core pipeline, a JavaScript port of the Python implementation (vision.py, wearable.py, fusion.py).
   Runs in the browser and in Node (for the parity tests against the Python reference). */
const Core = (function () {
  "use strict";
  const FPS = 10,
    IMU = 50,
    PATCH = 24,
    PATCH_SCALE = 8,
    NOISE_SD = 0.12;
  const ALERT_ON = 0.55,
    ALERT_OFF = 0.45;

  /* ---------- seeded camera noise (same generator as the Python export) ---------- */
  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function eyePatch(q, off, seed, i, out) {
    const r = mulberry32((Math.imul(seed, 1000003) + Math.imul(i, 7919)) >>> 0);
    for (let k = 0; k < 288; k++) {
      const u1 = Math.max(r(), 1e-12),
        u2 = r(),
        m = Math.sqrt(-2 * Math.log(u1));
      out[2 * k] =
        q[off + 2 * k] / PATCH_SCALE +
        NOISE_SD * m * Math.cos(2 * Math.PI * u2);
      out[2 * k + 1] =
        q[off + 2 * k + 1] / PATCH_SCALE +
        NOISE_SD * m * Math.sin(2 * Math.PI * u2);
    }
    return out;
  }

  /* ---------- landmark geometry ---------- */
  function ear(p, o) {
    // p1..p6 as x,y pairs starting at o
    const d = (a, b) =>
      Math.hypot(
        p[o + 2 * a] - p[o + 2 * b],
        p[o + 2 * a + 1] - p[o + 2 * b + 1],
      );
    return (d(1, 5) + d(2, 4)) / (2 * d(0, 3) + 1e-9);
  }
  function mar(p, o) {
    // left, top, right, bottom
    const d = (a, b) =>
      Math.hypot(
        p[o + 2 * a] - p[o + 2 * b],
        p[o + 2 * a + 1] - p[o + 2 * b + 1],
      );
    return d(1, 3) / (d(0, 2) + 1e-9);
  }

  /* ---------- eye-state CNN ---------- */
  function makeCNN(P) {
    const a1 = new Float64Array(8 * 22 * 22),
      q1 = new Float64Array(8 * 11 * 11);
    const a2 = new Float64Array(16 * 9 * 9),
      f = new Float64Array(256);
    return function closedProb(x) {
      for (let k = 0; k < 8; k++)
        for (let y = 0; y < 22; y++)
          for (let xx = 0; xx < 22; xx++) {
            let s = P.b1[k];
            for (let i = 0; i < 3; i++)
              for (let j = 0; j < 3; j++)
                s += x[(y + i) * 24 + xx + j] * P.w1[k * 9 + i * 3 + j];
            a1[(k * 22 + y) * 22 + xx] = s > 0 ? s : 0;
          }
      for (let k = 0; k < 8; k++)
        for (let y = 0; y < 11; y++)
          for (let xx = 0; xx < 11; xx++) {
            const b = (k * 22 + 2 * y) * 22 + 2 * xx;
            q1[(k * 11 + y) * 11 + xx] = Math.max(
              a1[b],
              a1[b + 1],
              a1[b + 22],
              a1[b + 23],
            );
          }
      for (let k = 0; k < 16; k++)
        for (let y = 0; y < 9; y++)
          for (let xx = 0; xx < 9; xx++) {
            let s = P.b2[k];
            for (let c = 0; c < 8; c++)
              for (let i = 0; i < 3; i++)
                for (let j = 0; j < 3; j++)
                  s +=
                    q1[(c * 11 + y + i) * 11 + xx + j] *
                    P.w2[k * 72 + c * 9 + i * 3 + j];
            a2[(k * 9 + y) * 9 + xx] = s > 0 ? s : 0;
          }
      for (let k = 0; k < 16; k++)
        for (let y = 0; y < 4; y++)
          for (let xx = 0; xx < 4; xx++) {
            const b = (k * 9 + 2 * y) * 9 + 2 * xx;
            f[k * 16 + y * 4 + xx] = Math.max(
              a2[b],
              a2[b + 1],
              a2[b + 9],
              a2[b + 10],
            );
          }
      let z0 = P.b3[0],
        z1 = P.b3[1];
      for (let i = 0; i < 256; i++) {
        z0 += f[i] * P.w3[2 * i];
        z1 += f[i] * P.w3[2 * i + 1];
      }
      return 1 / (1 + Math.exp(z0 - z1));
    };
  }

  /* ---------- vision window features ---------- */
  function visionFeatures(cp, mr, el) {
    // arrays already filtered to frames where the face was visible
    const n = cp.length;
    let closedN = 0,
      starts = 0,
      run = 0,
      longest = 0,
      yawn = 0,
      mm = 0,
      cm = 0,
      eb = 0;
    let prev = false;
    for (let i = 0; i < n; i++) {
      const c = cp[i] > 0.5;
      if (c) closedN++;
      if (i > 0 && c && !prev) starts++;
      if (c) {
        run++;
        if (run > longest) longest = run;
      } else run = 0;
      prev = c;
      if (mr[i] > 0.45) yawn++;
      mm += mr[i];
      cm += cp[i];
      if (el[i] < 0.2) eb++;
    }
    return [
      closedN / n,
      (starts * 60) / (n / FPS),
      longest / FPS,
      yawn / n,
      mm / n,
      cm / n,
      eb / n,
    ];
  }

  /* ---------- wearable: Welch PSD (scipy defaults) and features ---------- */
  const NP = 256,
    HOP = 128,
    NB = 129;
  const win = new Float64Array(NP),
    COS = new Float64Array(NB * NP),
    SIN = new Float64Array(NB * NP);
  let wsum = 0;
  for (let n = 0; n < NP; n++) {
    win[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / NP);
    wsum += win[n] * win[n];
  }
  for (let k = 0; k < NB; k++)
    for (let n = 0; n < NP; n++) {
      COS[k * NP + n] = Math.cos((2 * Math.PI * k * n) / NP);
      SIN[k * NP + n] = Math.sin((2 * Math.PI * k * n) / NP);
    }
  function welch(acc) {
    let mean = 0;
    for (let i = 0; i < acc.length; i++) mean += acc[i];
    mean /= acc.length;
    const x = new Float64Array(acc.length);
    for (let i = 0; i < acc.length; i++) x[i] = acc[i] - mean;
    const p = new Float64Array(NB),
      seg = new Float64Array(NP);
    let nseg = 0;
    for (let s = 0; s + NP <= x.length; s += HOP) {
      let m = 0;
      for (let n = 0; n < NP; n++) m += x[s + n];
      m /= NP;
      for (let n = 0; n < NP; n++) seg[n] = (x[s + n] - m) * win[n];
      for (let k = 0; k < NB; k++) {
        let re = 0,
          im = 0;
        for (let n = 0; n < NP; n++) {
          re += seg[n] * COS[k * NP + n];
          im -= seg[n] * SIN[k * NP + n];
        }
        let pw = (re * re + im * im) / (IMU * wsum);
        if (k > 0 && k < NB - 1) pw *= 2;
        p[k] += pw;
      }
      nseg++;
    }
    const f = new Float64Array(NB);
    for (let k = 0; k < NB; k++) {
      p[k] /= nseg;
      f[k] = (k * IMU) / NP;
    }
    return { f, p };
  }
  const BANDS = [
    [0.1, 0.8],
    [0.8, 2.0],
    [2.0, 5.0],
    [5.0, 12.0],
  ];
  function wearableFeatures(hr, spo, acc) {
    const { f, p } = welch(acc);
    let tot = 1e-12;
    for (let k = 0; k < NB; k++) tot += p[k];
    const band = BANDS.map(([a, b]) => {
      let s = 0;
      for (let k = 0; k < NB; k++) if (f[k] >= a && f[k] < b) s += p[k];
      return s / tot;
    });
    let best = -1,
      dom = 0,
      ssum = 0;
    const sel = [];
    for (let k = 0; k < NB; k++)
      if (f[k] >= 0.3 && f[k] <= 6) {
        sel.push(k);
        ssum += p[k];
        if (p[k] > best) {
          best = p[k];
          dom = f[k];
        }
      }
    let ent = 0;
    for (const k of sel) {
      const q = p[k] / (ssum + 1e-12);
      ent -= q * Math.log(q + 1e-12);
    }
    ent /= Math.log(sel.length);
    const peak = best / (ssum + 1e-12);
    const n = hr.length;
    let hm = 0,
      sm = 0,
      am = 0;
    for (let i = 0; i < n; i++) {
      hm += hr[i];
      sm += spo[i];
    }
    hm /= n;
    sm /= n;
    let hv = 0,
      cov = 0,
      tv = 0;
    const tm = (n - 1) / 2;
    for (let i = 0; i < n; i++) {
      hv += (hr[i] - hm) ** 2;
      cov += (i - tm) * (hr[i] - hm);
      tv += (i - tm) ** 2;
    }
    for (let i = 0; i < acc.length; i++) am += acc[i] * acc[i];
    return [
      hm,
      Math.sqrt(hv / n),
      cov / tv,
      sm,
      ...band,
      dom,
      ent,
      peak,
      Math.sqrt(am / acc.length),
    ];
  }

  /* ---------- gradient-boosted trees (XGBoost dump), fusion, alerts ---------- */
  function xgb(m, x) {
    const xf = Float64Array.from(x, Math.fround);
    let tot = Math.log(m.base / (1 - m.base));
    for (const r of m.roots) {
      let n = r;
      while (m.f[n] >= 0) n = xf[m.f[n]] < m.t[n] ? m.l[n] : m.r[n];
      tot += m.v[n];
    }
    return 1 / (1 + Math.exp(-tot));
  }
  const logit = (p) => {
    p = Math.min(1 - 1e-3, Math.max(1e-3, p));
    return Math.log(p / (1 - p));
  };
  function fuse(F, pv, pw, face) {
    const x0 = face ? logit(pv) : 0,
      x1 = logit(pw),
      x2 = face ? 1 : 0;
    const z = F.coef[0] * x0 + F.coef[1] * x1 + F.coef[2] * x2 + F.intercept;
    return { risk: 1 / (1 + Math.exp(-z)), x: [x0, x1, x2], z };
  }
  class AlertState {
    constructor() {
      this.on = false;
      this.streak = 0;
    }
    update(risk) {
      if (!this.on) {
        this.streak = risk >= ALERT_ON ? this.streak + 1 : 0;
        if (this.streak >= 2) {
          this.on = true;
          return "ALERT_ON";
        }
      } else if (risk < ALERT_OFF) {
        this.on = false;
        this.streak = 0;
        return "ALERT_OFF";
      }
      return null;
    }
  }

  /* ---------- data blob ---------- */
  function views(buf, manifest) {
    const T = { int16: Int16Array, int8: Int8Array, uint8: Uint8Array };
    return manifest.map((m) => {
      const s = {
        id: m.id,
        name: m.name,
        role: m.role,
        station: m.station,
        n_s: m.n_s,
        seed: m.seed,
      };
      for (const k of ["lm", "hr", "spo", "acc", "face", "truth", "patches"])
        s[k] = new T[m[k][2]](buf, m[k][0], m[k][1]);
      return s;
    });
  }

  /* ---------- the edge pipeline, one frame at a time ---------- */
  class Engine {
    constructor(models, sess) {
      this.M = models;
      this.S = sess;
      this.cnn = makeCNN(models.cnn);
      this.tmp = new Float64Array(PATCH * PATCH);
      this.lmf = new Float64Array(32);
      this.reset();
    }
    reset() {
      this.i = 0;
      this.blocked = false;
      this.alert = new AlertState();
      const n = this.S.n_s * FPS;
      this.earlm = new Float64Array(n);
      this.marlm = new Float64Array(n);
      this.cp = new Float64Array(n);
      this.vis = new Uint8Array(n);
      this.records = [];
      this.last = null;
    }
    done() {
      return this.i >= this.S.n_s * FPS;
    }
    frame() {
      // process the next camera frame; returns info for drawing
      const S = this.S,
        i = this.i++;
      for (let k = 0; k < 32; k++) this.lmf[k] = S.lm[i * 32 + k] / 100;
      const e = (ear(this.lmf, 0) + ear(this.lmf, 12)) / 2,
        m = mar(this.lmf, 24);
      const vis = S.face[i] === 1 && !this.blocked;
      this.earlm[i] = e;
      this.marlm[i] = m;
      this.vis[i] = vis ? 1 : 0;
      let cp = NaN;
      if (vis) {
        eyePatch(S.patches, i * 576, S.seed, i, this.tmp);
        cp = this.cnn(this.tmp);
      }
      this.cp[i] = cp;
      const info = {
        i,
        ear: e,
        mar: m,
        cp,
        vis,
        lm: this.lmf,
        patch: vis ? this.tmp : null,
        win: null,
      };
      if ((i + 1) % FPS === 0) {
        const s = (i + 1) / FPS - 1;
        if (s >= 9 && (s - 9) % 5 === 0) info.win = this.decide(s);
      }
      return info;
    }
    decide(s) {
      const S = this.S,
        a = (s - 9) * FPS,
        b = (s + 1) * FPS,
        cp = [],
        mr = [],
        el = [];
      let nv = 0;
      for (let i = a; i < b; i++)
        if (this.vis[i]) {
          nv++;
          cp.push(this.cp[i]);
          mr.push(this.marlm[i]);
          el.push(this.earlm[i]);
        }
      const ok = nv / (b - a) >= 0.8;
      let vf = null,
        pv = null;
      if (ok) {
        vf = visionFeatures(cp, mr, el);
        pv = xgb(this.M.mv, vf);
      }
      const hr = Array.from(S.hr.subarray(s - 9, s + 1), (v) => v / 10),
        sp = Array.from(S.spo.subarray(s - 9, s + 1), (v) => v / 100);
      const acc = Float64Array.from(
        S.acc.subarray((s - 9) * IMU, (s + 1) * IMU),
        (v) => v / 1000,
      );
      const wf = wearableFeatures(hr, sp, acc),
        pw = xgb(this.M.mw, wf);
      const fu = fuse(this.M.fusion, ok ? pv : 0.5, pw, ok);
      const ev = this.alert.update(fu.risk);
      const w = welch(acc);
      const rec = {
        s,
        ok,
        pv,
        pw,
        risk: fu.risk,
        alert: this.alert.on,
        ev,
        vf,
        wf,
        fx: fu.x,
        z: fu.z,
        streak: this.alert.streak,
        psdf: w.f,
        psd: w.p,
      };
      this.records.push(rec);
      this.last = rec;
      return rec;
    }
  }

  return {
    Engine,
    views,
    makeCNN,
    welch,
    wearableFeatures,
    visionFeatures,
    xgb,
    fuse,
    AlertState,
    eyePatch,
    ear,
    mar,
    ALERT_ON,
    ALERT_OFF,
    FPS,
    IMU,
  };
})();
