(function () {
  "use strict";
  var $ = function (i) {
      return document.getElementById(i);
    },
    SHIFT = 240,
    TOTAL = 2400;
  var MODELS = JSON.parse($("models").textContent),
    MAN = JSON.parse($("manifest").textContent),
    STAT = JSON.parse($("static").textContent),
    REF = JSON.parse($("refc").textContent);
  var REDUCED = matchMedia("(prefers-reduced-motion:reduce)").matches;
  var sessions = [],
    engines = [],
    lastInfo = {},
    touched = {};
  var fmt = function (s) {
    s = Math.max(0, Math.floor(s));
    return (
      ("0" + Math.floor(s / 60)).slice(-2) + ":" + ("0" + (s % 60)).slice(-2)
    );
  };
  var pc = function (x) {
    return Math.round(x * 100) + "%";
  };
  var esc = function (s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  };

  /* ================= BACKEND (REST-style service, runs in this tab) ================= */
  var Server = (function () {
    var db,
      log = [],
      clock = 0,
      routes = [];
    function init(list) {
      db = {
        seq: 0,
        workers: list.map(function (s) {
          return {
            id: s.id,
            name: s.name,
            role: s.role,
            station: s.station,
            series: [],
            last: null,
            breakOrdered: false,
            tampered: false,
          };
        }),
        alerts: [],
        audit: [],
      };
      log = [];
    }
    var find = function (id) {
      return db.workers.filter(function (w) {
        return w.id === id;
      })[0];
    };
    var findA = function (id) {
      return db.alerts.filter(function (a) {
        return a.id === id;
      })[0];
    };
    var aud = function (who, what, ref) {
      db.audit.unshift({ t: clock, who: who, what: what, ref: ref });
      if (db.audit.length > 200) db.audit.pop();
    };
    var status = function (w) {
      return !w.last
        ? "starting"
        : w.last.alert
          ? "alert"
          : w.last.risk >= 0.45
            ? "watch"
            : "normal";
    };
    var pub = function (w) {
      var l = w.last || {};
      return {
        id: w.id,
        name: w.name,
        role: w.role,
        station: w.station,
        status: status(w),
        risk: l.risk == null ? null : l.risk,
        camera: w.last ? (l.ok ? "ok" : "blind") : null,
        hr: l.hr == null ? null : l.hr,
        spo2: l.spo == null ? null : l.spo,
        alerts: db.alerts.filter(function (a) {
          return a.worker === w.id;
        }).length,
        breakOrdered: w.breakOrdered,
        tampered: w.tampered,
        spark: w.series.slice(-20).map(function (r) {
          return r.risk;
        }),
      };
    };
    function R(m, p, fn) {
      routes.push([
        m,
        new RegExp("^" + p.replace(/:\w+/g, "([^/]+)") + "$"),
        fn,
      ]);
    }
    R("GET", "/api/health", function () {
      return [
        200,
        {
          ok: true,
          service: "fatigue-monitor-api",
          workers: db.workers.length,
          shift_time: clock,
        },
      ];
    });
    R("GET", "/api/workers", function () {
      return [200, db.workers.map(pub)];
    });
    R("GET", "/api/workers/:id", function (a) {
      var w = find(a[0]);
      if (!w) return [404, { error: "Unknown worker " + a[0] }];
      var o = pub(w);
      o.series = w.series;
      o.alert_list = db.alerts.filter(function (x) {
        return x.worker === w.id;
      });
      return [200, o];
    });
    R("POST", "/api/workers/:id/camera", function (a, b) {
      var w = find(a[0]);
      if (!w) return [404, { error: "Unknown worker " + a[0] }];
      if (typeof b.covered !== "boolean")
        return [422, { error: "covered must be true or false" }];
      w.tampered = w.tampered || b.covered;
      aud(
        "Supervisor",
        b.covered ? "covered the camera (test)" : "uncovered the camera",
        w.id,
      );
      return [200, { worker: w.id, covered: b.covered }];
    });
    R("POST", "/api/readings", function (a, b) {
      var w = find(b.worker);
      if (!w) return [404, { error: "Unknown worker " + b.worker }];
      if (!Number.isInteger(b.s) || b.s < 0)
        return [422, { error: "s must be a whole number of seconds" }];
      if (typeof b.risk !== "number" || !(b.risk >= 0 && b.risk <= 1))
        return [422, { error: "risk must be a number between 0 and 1" }];
      var e = {
        s: b.s,
        risk: b.risk,
        pv: b.pv,
        pw: b.pw,
        ok: !!b.ok,
        alert: !!b.alert,
        hr: b.hr,
        spo: b.spo,
      };
      w.series.push(e);
      w.last = e;
      var out = { stored: true, event: b.ev || null, alert: null };
      var open = db.alerts.filter(function (x) {
        return x.worker === w.id && x.cleared == null;
      })[0];
      if (b.ev === "ALERT_ON") {
        var id = "A-" + ("00" + ++db.seq).slice(-3);
        db.alerts.push({
          id: id,
          worker: w.id,
          t: b.s,
          status: "open",
          basis: e.ok ? "Camera + wristband" : "Wristband only (camera blind)",
          risk: b.risk,
          peak: b.risk,
          cleared: null,
          ackBy: null,
          ackT: null,
          closedT: null,
          outcome: null,
        });
        aud("System", "raised alert for " + w.name, id);
        out.alert = id;
      } else if (open) {
        open.peak = Math.max(open.peak, b.risk);
        if (b.ev === "ALERT_OFF") {
          open.cleared = b.s;
          aud(
            "System",
            "risk dropped below the clear line for " + w.name,
            open.id,
          );
        }
      }
      return [201, out];
    });
    R("GET", "/api/alerts", function (a, b, q) {
      var l = db.alerts.slice().reverse();
      if (q.status)
        l = l.filter(function (x) {
          return x.status === q.status;
        });
      return [
        200,
        l.map(function (x) {
          var w = find(x.worker);
          return Object.assign(
            { name: w.name, role: w.role, station: w.station },
            x,
          );
        }),
      ];
    });
    function act(id, fn) {
      var al = findA(id);
      if (!al) return [404, { error: "Unknown alert " + id }];
      if (al.status === "resolved")
        return [409, { error: "Alert " + id + " is already closed" }];
      return fn(al);
    }
    R("POST", "/api/alerts/:id/ack", function (a, b) {
      return act(a[0], function (al) {
        if (al.status !== "open")
          return [
            409,
            { error: "Alert " + al.id + " is already acknowledged" },
          ];
        al.status = "acknowledged";
        al.ackBy = String(b.by || "Supervisor");
        al.ackT = clock;
        aud(al.ackBy, "acknowledged the alert", al.id);
        return [200, al];
      });
    });
    R("POST", "/api/alerts/:id/resolve", function (a, b) {
      return act(a[0], function (al) {
        var o = String(b.outcome || "").trim();
        if (!o) return [422, { error: "outcome is required" }];
        if (al.status === "open") {
          al.status = "acknowledged";
          al.ackBy = String(b.by || "Supervisor");
          al.ackT = clock;
        }
        al.status = "resolved";
        al.closedT = clock;
        al.outcome = o;
        if (b.break) find(al.worker).breakOrdered = true;
        aud(al.ackBy, "closed the alert: " + o, al.id);
        return [200, al];
      });
    });
    R("GET", "/api/stats", function () {
      var al = db.alerts,
        acked = al.filter(function (x) {
          return x.ackT != null;
        }),
        n = 0;
      db.workers.forEach(function (w) {
        n += w.series.length;
      });
      var st = { normal: 0, watch: 0, alert: 0, starting: 0 };
      db.workers.forEach(function (w) {
        st[status(w)]++;
      });
      var blind = db.workers.filter(function (w) {
        return w.last && !w.last.ok;
      }).length;
      return [
        200,
        {
          workers: db.workers.length,
          status: st,
          camera_blind: blind,
          alerts_total: al.length,
          alerts_open: al.filter(function (x) {
            return x.status === "open";
          }).length,
          alerts_active: al.filter(function (x) {
            return x.status !== "resolved";
          }).length,
          mean_ack_delay_s: acked.length
            ? acked.reduce(function (s, x) {
                return s + x.ackT - x.t;
              }, 0) / acked.length
            : null,
          readings: n,
          shift_time: clock,
        },
      ];
    });
    R("GET", "/api/audit", function () {
      return [200, db.audit.slice(0, 60)];
    });
    R("GET", "/api/report", function () {
      var h =
          "alert,worker,name,station,raised_at,basis,peak_risk,cleared_at,status,acknowledged_by,outcome",
        rows = db.alerts.map(function (x) {
          var w = find(x.worker);
          return [
            x.id,
            x.worker,
            w.name,
            w.station,
            fmt(x.t),
            x.basis,
            x.peak.toFixed(3),
            x.cleared == null ? "" : fmt(x.cleared),
            x.status,
            x.ackBy || "",
            x.outcome || "",
          ]
            .map(function (c) {
              return /[",]/.test(c)
                ? '"' + String(c).replace(/"/g, '""') + '"'
                : c;
            })
            .join(",");
        });
      return [200, { csv: [h].concat(rows).join("\n") }];
    });
    R("GET", "/api/verify", function () {
      var n = 0,
        ok = 0,
        mx = 0,
        skip = [],
        evbad = 0;
      db.workers.forEach(function (w) {
        if (w.tampered) {
          skip.push(w.id);
          return;
        }
        var ref = REF[w.id],
          bys = {};
        ref.forEach(function (r) {
          bys[r[0]] = r;
        });
        var s0 = 0;
        w.series.forEach(function (e) {
          var r = bys[e.s];
          if (!r) return;
          n++;
          var d = Math.abs(r[1] - e.risk);
          mx = Math.max(mx, d);
          if (d < 1e-6) ok++;
        });
      });
      var ev = 0,
        evok = 0;
      db.alerts.forEach(function () {});
      db.workers.forEach(function (w) {
        if (w.tampered) return;
        var got = db.alerts
          .filter(function (a) {
            return a.worker === w.id;
          })
          .map(function (a) {
            return a.t;
          });
        var upto = w.series.length ? w.series[w.series.length - 1].s : -1;
        var exp = REF[w.id]
          .filter(function (r) {
            return r[2] === "ALERT_ON" && r[0] <= upto;
          })
          .map(function (r) {
            return r[0];
          });
        ev += exp.length;
        exp.forEach(function (t) {
          if (got.indexOf(t) >= 0) evok++;
        });
        if (got.length !== exp.length) evbad++;
      });
      return [
        200,
        {
          decisions_checked: n,
          matching: ok,
          max_abs_difference: mx,
          alert_events_expected: ev,
          alert_events_matching: evok,
          workers_with_extra_or_missing_alerts: evbad,
          excluded_workers: skip,
        },
      ];
    });
    async function call(method, url, body) {
      var t0 = performance.now(),
        p = url.split("?"),
        q = {};
      (p[1] || "").split("&").forEach(function (kv) {
        if (kv) {
          var a = kv.split("=");
          q[a[0]] = decodeURIComponent(a[1] || "");
        }
      });
      var res = null;
      for (var i = 0; i < routes.length; i++) {
        var r = routes[i];
        if (r[0] !== method) continue;
        var m = r[1].exec(p[0]);
        if (m) {
          try {
            res = r[2](m.slice(1), body || {}, q);
          } catch (e) {
            res = [500, { error: String(e.message) }];
          }
          break;
        }
      }
      if (!res) res = [404, { error: "No such route: " + method + " " + p[0] }];
      await 0;
      log.unshift({
        t: clock,
        method: method,
        path: url,
        status: res[0],
        ms: performance.now() - t0,
      });
      if (log.length > 120) log.pop();
      return { status: res[0], data: res[1] };
    }
    return {
      init: init,
      call: call,
      tick: function (s) {
        clock = s;
      },
      log: function () {
        return log;
      },
    };
  })();
  var API = function (m, u, b) {
    return Server.call(m, u, b);
  };

  /* ================= EDGE SIMULATION ================= */
  function makeEngines() {
    engines = sessions.map(function (s) {
      return new Core.Engine(MODELS, s);
    });
    lastInfo = {};
    touched = {};
    Server.init(sessions);
  }
  var simT = 0,
    speed = 3,
    playing = false,
    ended = false,
    prev = 0;
  function ingest(i, rec) {
    var s = sessions[i];
    API("POST", "/api/readings", {
      worker: s.id,
      s: rec.s,
      risk: rec.risk,
      pv: rec.pv,
      pw: rec.pw,
      ok: rec.ok,
      alert: rec.alert,
      ev: rec.ev,
      hr: s.hr[rec.s] / 10,
      spo: s.spo[rec.s] / 100,
    }).then(function (r) {
      if (r.data.event === "ALERT_ON") toast(s, r.data.alert, rec);
    });
  }
  function step() {
    var target = Math.min(TOTAL, Math.floor(simT * 10));
    for (var k = 0; k < engines.length; k++) {
      var e = engines[k];
      while (e.i < target) {
        var inf = e.frame();
        lastInfo[k] = inf;
        if (inf.win) ingest(k, inf.win);
      }
    }
    Server.tick(simT);
    if (simT >= SHIFT && !ended) {
      ended = true;
      playing = false;
      setPlayLabel();
      refresh();
    }
  }
  function loop(ts) {
    requestAnimationFrame(loop);
    var dt = Math.min(0.1, (ts - prev) / 1000 || 0);
    prev = ts;
    if (playing && simT < SHIFT) {
      simT = Math.min(SHIFT, simT + dt * speed);
      step();
    }
    drawClock();
    if (view === "live") drawLive();
  }
  function drawClock() {
    $("clk").textContent = "Shift " + fmt(simT) + " / " + fmt(SHIFT);
    $("clkbar").style.width = (simT / SHIFT) * 100 + "%";
  }
  function setPlayLabel() {
    $("bplay").textContent = ended
      ? "Shift complete"
      : playing
        ? "Pause"
        : "Resume";
  }
  function restart() {
    simT = 0;
    ended = false;
    makeEngines();
    playing = true;
    setPlayLabel();
    closeDrawer();
    refresh();
    buildLive();
  }

  /* ================= FRONTEND ================= */
  var view = "dash",
    W = [],
    A = [],
    S = {},
    busy = false,
    drawerId = null,
    wfilter = "all",
    afilter = "all",
    liveIdx = 0;
  var TITLE = {
    dash: 1,
    workers: 1,
    alerts: 1,
    live: 1,
    results: 1,
    system: 1, sup: 1, lab: 1,
  };
  function nav(v) {
    if (!TITLE[v]) v = "dash";
    view = v;
    try {
      history.replaceState(null, "", "#" + v);
    } catch (e) {}
    document.querySelectorAll(".view").forEach(function (x) {
      x.hidden = x.id !== "v-" + v;
    });
    document.querySelectorAll("[data-nav]").forEach(function (b) {
      if (b.closest("nav")) b.classList.toggle("on", b.dataset.nav === v);
    });
    window.scrollTo(0, 0);
    if (v === "live") buildLive();
    if (v === "system") renderSystem();
    if (v === "results") renderResults();
    refresh();
  }
  function toast(s, id, rec) {
    var d = document.createElement("div");
    d.className = "toast";
    d.innerHTML =
      "<b>Fatigue alert · " +
      esc(s.name) +
      "</b><br>" +
      esc(s.role) +
      ", " +
      esc(s.station) +
      " · risk " +
      pc(rec.risk) +
      " at " +
      fmt(rec.s) +
      '<br><button class="btn2" data-act="openA" data-w="' +
      s.id +
      '" type="button" style="margin-top:6px">View worker</button>';
    var tc = $("toasts");
    tc.appendChild(d);
    while (tc.children.length > 2) tc.removeChild(tc.firstChild);
    setTimeout(function () {
      d.remove();
    }, 6000);
  }
  var SP = function (a) {
    if (a.length < 2) return "";
    var p = a
      .map(function (v, i) {
        return (
          ((i / (a.length - 1)) * 60).toFixed(1) +
          "," +
          (18 - v * 17).toFixed(1)
        );
      })
      .join(" ");
    return (
      '<svg viewBox="0 0 60 18" width="100%" height="18" preserveAspectRatio="none" aria-hidden="true"><polyline points="' +
      p +
      '" fill="none" stroke="var(--acc)" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>'
    );
  };
  var LAB = {
      normal: "Normal",
      watch: "Watch",
      alert: "ALERT",
      starting: "Calibrating",
    },
    ICO = { normal: "●", watch: "▲", alert: "■", starting: "○" };
  var pill = function (s) {
    return '<span class="pill ' + s + '">' + ICO[s] + " " + LAB[s] + "</span>";
  };
  var ALAB = { open: "Open", acknowledged: "Acknowledged", resolved: "Closed" };
  function alertCard(a, full) {
    var btn = "";
    if (a.status === "open")
      btn =
        '<button class="btn2 pri" data-act="ack" data-id="' +
        a.id +
        '" type="button">Acknowledge</button>';
    else if (a.status === "acknowledged")
      btn =
        '<button class="btn2" data-act="res" data-id="' +
        a.id +
        '" data-o="Break given" data-b="1" type="button">Send to break</button><button class="btn2" data-act="res" data-id="' +
        a.id +
        '" data-o="Checked, fit to work" type="button">Fit to work</button><button class="btn2" data-act="res" data-id="' +
        a.id +
        '" data-o="False alarm" type="button">False alarm</button>';
    return (
      '<div class="alertitem ' +
      a.status +
      '"><div class="row"><b>' +
      esc(a.name) +
      '</b><span class="pill ' +
      a.status +
      '">' +
      ALAB[a.status] +
      "</span></div>" +
      '<div class="small muted">' +
      a.id +
      " · " +
      esc(a.station) +
      " · raised " +
      fmt(a.t) +
      " · " +
      esc(a.basis) +
      "</div>" +
      '<div class="small">Risk ' +
      pc(a.risk) +
      " → peak " +
      pc(a.peak) +
      (a.cleared != null
        ? " · model cleared at " + fmt(a.cleared)
        : " · still above the clear line") +
      "</div>" +
      (a.outcome
        ? '<div class="small">Outcome: <b>' +
          esc(a.outcome) +
          "</b> by " +
          esc(a.ackBy) +
          " at " +
          fmt(a.closedT) +
          "</div>"
        : a.ackBy
          ? '<div class="small">Taken by ' +
            esc(a.ackBy) +
            " at " +
            fmt(a.ackT) +
            "</div>"
          : "") +
      (btn ? '<div class="acts">' + btn + "</div>" : "") +
      "</div>"
    );
  }
  function refresh() {
    if (busy) return;
    busy = true;
    var jobs = [
      API("GET", "/api/workers"),
      API("GET", "/api/alerts"),
      API("GET", "/api/stats"),
    ];
    if (drawerId) jobs.push(API("GET", "/api/workers/" + drawerId));
    return Promise.all(jobs)
      .then(function (r) {
        W = r[0].data;
        A = r[1].data;
        S = r[2].data;
        paint(r[3] && r[3].data);
      })
      .then(
        function () {
          busy = false;
        },
        function (e) {
          busy = false;
          console.error(e);
        },
      );
  }
  function paint(det) {
    var ab = $("abadge");
    ab.textContent = S.alerts_active || "";
    ab.dataset.n = S.alerts_active || 0;
    if (view === "dash") paintDash();
    if (view === "workers") paintWorkers();
    if (view === "alerts") paintAlerts();
    if (view === "system") paintLog();
    if (drawerId && det) paintDrawer(det);
  }
  function paintDash() {
    var bn = $("banner");
    bn.innerHTML = ended
      ? '<div class="banner"><div><b>Shift complete.</b> ' +
        S.alerts_total +
        " alert" +
        (S.alerts_total === 1 ? "" : "s") +
        " were raised for " +
        S.workers +
        ' workers. Review them in the alert queue, or replay the shift.</div><div class="acts"><button class="btn2 pri" data-act="restart" type="button">Replay shift</button></div></div>'
      : "";
    $("kpis").innerHTML = [
      ["Workers on shift", S.workers, ""],
      ["Active alerts", S.alerts_active, S.alerts_active ? "bad" : ""],
      ["On watch", S.status.watch, S.status.watch ? "wa" : ""],
      ["Camera blind now", S.camera_blind, ""],
    ]
      .map(function (k) {
        return (
          '<div class="card kpi ' +
          k[2] +
          '"><b class="num">' +
          k[1] +
          "</b><span>" +
          k[0] +
          "</span></div>"
        );
      })
      .join("");
    $("cards").innerHTML = W.map(function (w) {
      return (
        '<button class="wc ' +
        w.status +
        '" data-act="open" data-w="' +
        w.id +
        '" type="button"><div class="row"><span class="n">' +
        esc(w.name) +
        "</span>" +
        pill(w.status) +
        '</div><span class="r">' +
        w.id +
        " · " +
        esc(w.role) +
        " · " +
        esc(w.station) +
        '</span><div class="meter"><i style="width:' +
        (w.risk == null ? 0 : Math.round(w.risk * 100)) +
        '%"></i></div><div class="row small"><span class="num">' +
        (w.risk == null ? "—" : "Risk " + pc(w.risk)) +
        '</span><span class="muted">' +
        (w.camera === "blind"
          ? "wristband only"
          : w.breakOrdered
            ? "break ordered"
            : "") +
        "</span></div>" +
        SP(w.spark) +
        "</button>"
      );
    }).join("");
    $("feed").innerHTML = A.length
      ? A.slice(0, 5)
          .map(function (a) {
            return alertCard(a);
          })
          .join("")
      : '<p class="muted small" style="margin:0">No alerts yet. Alerts appear when the fused risk stays at or above 55% for two checks in a row.</p>';
    paintHeat();
  }
  var HEAT = null;
  function paintHeat() {
    Promise.all(
      W.map(function (w) {
        return API("GET", "/api/workers/" + w.id);
      }),
    ).then(function (rs) {
      var cols = Math.floor((SHIFT - 9) / 5) + 1,
        h = "";
      rs.forEach(function (r) {
        var w = r.data,
          m = {};
        w.series.forEach(function (e) {
          m[e.s] = e;
        });
        var c = "";
        for (var k = 0; k < cols; k++) {
          var e = m[9 + k * 5],
            f = "var(--line)";
          if (e) {
            f =
              e.risk >= 0.55
                ? "var(--hm3)"
                : e.risk >= 0.45
                  ? "var(--hm2)"
                  : e.risk >= 0.25
                    ? "var(--hm1)"
                    : "var(--hm0)";
          }
          c +=
            '<rect x="' + k + '" y="0" width="1" height="1" fill="' + f + '"/>';
          if (e && !e.ok)
            c +=
              '<rect x="' +
              k +
              '" y=".66" width="1" height=".34" fill="var(--ink)"/>';
        }
        h +=
          '<div class="line"><span>' +
          esc(w.name) +
          '</span><svg viewBox="0 0 ' +
          cols +
          ' 1" preserveAspectRatio="none" shape-rendering="crispEdges" role="img" aria-label="Risk over the shift for ' +
          esc(w.name) +
          '">' +
          c +
          "</svg></div>";
      });
      $("heat").innerHTML = h;
    });
  }
  function paintWorkers() {
    var q = ($("q").value || "").toLowerCase();
    var l = W.filter(function (w) {
      return (
        (wfilter === "all" || w.status === wfilter) &&
        (!q ||
          (w.name + w.role + w.station + w.id).toLowerCase().indexOf(q) >= 0)
      );
    });
    $("wbody").innerHTML = l.length
      ? l
          .map(function (w) {
            return (
              '<tr data-w="' +
              w.id +
              '"><td class="mono">' +
              w.id +
              "</td><td><b>" +
              esc(w.name) +
              "</b></td><td>" +
              esc(w.role) +
              "</td><td>" +
              esc(w.station) +
              "</td><td>" +
              pill(w.status) +
              '</td><td class="r num">' +
              (w.risk == null ? "—" : pc(w.risk)) +
              "</td><td>" +
              (w.camera == null
                ? "—"
                : w.camera === "ok"
                  ? "Seeing face"
                  : "Blind") +
              '</td><td class="r num">' +
              (w.hr == null ? "—" : Math.round(w.hr) + " bpm") +
              '</td><td class="r num">' +
              (w.spo2 == null ? "—" : w.spo2.toFixed(1) + "%") +
              '</td><td class="r num">' +
              w.alerts +
              "</td></tr>"
            );
          })
          .join("")
      : '<tr><td colspan="10" class="muted">No workers match.</td></tr>';
    $("chips").innerHTML = ["all", "alert", "watch", "normal"]
      .map(function (f) {
        return (
          '<button class="chip' +
          (wfilter === f ? " on" : "") +
          '" data-act="wf" data-f="' +
          f +
          '" type="button">' +
          (f === "all" ? "All" : LAB[f]) +
          "</button>"
        );
      })
      .join(" ");
  }
  function paintAlerts() {
    var l = A.filter(function (a) {
      return (
        afilter === "all" ||
        (afilter === "active" ? a.status !== "resolved" : a.status === afilter)
      );
    });
    $("achips").innerHTML = [
      ["all", "All"],
      ["active", "Active"],
      ["open", "Open"],
      ["resolved", "Closed"],
    ]
      .map(function (f) {
        return (
          '<button class="chip' +
          (afilter === f[0] ? " on" : "") +
          '" data-act="af" data-f="' +
          f[0] +
          '" type="button">' +
          f[1] +
          "</button>"
        );
      })
      .join(" ");
    $("aq").innerHTML = l.length
      ? l
          .map(function (a) {
            return alertCard(a, 1);
          })
          .join("")
      : '<div class="card muted">No alerts in this view yet.</div>';
    API("GET", "/api/audit").then(function (r) {
      $("audit").innerHTML = r.data.length
        ? r.data
            .slice(0, 14)
            .map(function (e) {
              return (
                '<div class="st"><span><b>' +
                fmt(e.t) +
                "</b> " +
                esc(e.who) +
                " " +
                esc(e.what) +
                '</span><span class="muted mono">' +
                esc(e.ref) +
                "</span></div>"
              );
            })
            .join("")
        : '<span class="muted">Nothing yet.</span>';
    });
  }
  function openDrawer(id) {
    drawerId = id;
    $("drawer").hidden = false;
    $("dp").innerHTML = '<p class="muted">Loading…</p>';
    refresh();
  }
  function closeDrawer() {
    drawerId = null;
    $("drawer").hidden = true;
  }
  function paintDrawer(d) {
    var i = sessions.findIndex(function (s) {
        return s.id === d.id;
      }),
      sess = sessions[i];
    var X = function (s) {
        return ((s / SHIFT) * 600).toFixed(1);
      },
      Y = function (v) {
        return (150 - v * 140).toFixed(1);
      };
    var risk = d.series
      .map(function (e) {
        return X(e.s) + "," + Y(e.risk);
      })
      .join(" ");
    var tr = [];
    for (var s = 0; s <= Math.min(SHIFT - 1, Math.floor(simT)); s += 2)
      tr.push(X(s) + "," + Y(sess.truth[s] / 255));
    var spans = "";
    d.alert_list.forEach(function (a) {
      var e = a.cleared == null ? Math.max(a.t, simT) : a.cleared;
      spans +=
        '<rect x="' +
        X(a.t) +
        '" y="10" width="' +
        Math.max(2, X(e) - X(a.t)) +
        '" height="140" fill="var(--bad)" opacity=".13"/>';
    });
    d.series.forEach(function (e) {
      if (!e.ok)
        spans +=
          '<rect x="' +
          X(e.s - 4) +
          '" y="144" width="' +
          X(5) +
          '" height="6" fill="var(--ink)" opacity=".55"/>';
    });
    var svg =
      '<svg viewBox="0 0 600 170" width="100%" role="img" aria-label="Risk over the shift" style="display:block">' +
      spans +
      '<line x1="0" x2="600" y1="' +
      Y(0.55) +
      '" y2="' +
      Y(0.55) +
      '" stroke="var(--bad)" stroke-dasharray="4 4" stroke-width="1"/><text x="2" y="' +
      (Y(0.55) - 3) +
      '" font-size="10" fill="var(--bad)">alert line 55%</text>' +
      '<line x1="0" x2="600" y1="' +
      Y(0.45) +
      '" y2="' +
      Y(0.45) +
      '" stroke="var(--mute)" stroke-dasharray="2 4" stroke-width="1"/><text x="2" y="' +
      (Y(0.45) + 11) +
      '" font-size="10" fill="var(--mute)">clear line 45%</text>' +
      '<polyline points="' +
      tr.join(" ") +
      '" fill="none" stroke="var(--mute)" stroke-width="1.4" stroke-dasharray="3 3"/>' +
      '<polyline points="' +
      risk +
      '" fill="none" stroke="var(--acc)" stroke-width="2.4" stroke-linejoin="round"/>' +
      '<line x1="' +
      X(simT) +
      '" x2="' +
      X(simT) +
      '" y1="10" y2="150" stroke="var(--ink)" stroke-width="1" opacity=".5"/>' +
      [0, 60, 120, 180, 240]
        .map(function (t) {
          return (
            '<text x="' +
            Math.min(582, Math.max(0, X(t) - (t ? 10 : 0))) +
            '" y="166" font-size="10" fill="var(--mute)">' +
            fmt(t) +
            "</text>"
          );
        })
        .join("") +
      "</svg>";
    var l = d.series[d.series.length - 1];
    $("dp").innerHTML =
      '<div class="row"><div><h2 style="font-size:19px">' +
      esc(d.name) +
      '</h2><div class="muted small">' +
      d.id +
      " · " +
      esc(d.role) +
      " · " +
      esc(d.station) +
      '</div></div><button class="btn2" data-act="close" type="button">Close</button></div>' +
      '<div class="row">' +
      pill(d.status) +
      (d.breakOrdered ? '<span class="pill watch">Break ordered</span>' : "") +
      '<span class="num">' +
      (d.risk == null ? "" : "Risk " + pc(d.risk)) +
      "</span></div>" +
      '<div class="card"><h3>Fatigue risk over the shift</h3>' +
      svg +
      '<div class="legend"><span><i style="background:var(--acc)"></i>risk from the system</span><span><i style="background:var(--mute)"></i>true fatigue level (known only because the data is simulated)</span><span><i style="background:var(--bad);opacity:.3"></i>alert active</span><span><i style="background:var(--ink);height:5px;vertical-align:1px"></i>camera blind</span></div></div>' +
      '<div class="card"><h3>Latest check' +
      (l ? ' <span class="small muted">at ' + fmt(l.s) + "</span>" : "") +
      "</h3>" +
      (l
        ? '<div class="kv"><span>Camera model risk</span><span class="num">' +
          (l.ok && l.pv != null ? pc(l.pv) : "no face visible") +
          '</span><span>Wristband model risk</span><span class="num">' +
          pc(l.pw) +
          '</span><span>Fused risk</span><span class="num"><b>' +
          pc(l.risk) +
          '</b></span><span>Heart rate</span><span class="num">' +
          Math.round(l.hr) +
          ' bpm</span><span>SpO₂</span><span class="num">' +
          l.spo.toFixed(1) +
          "%</span></div>"
        : '<span class="muted small">The first check arrives after 10 seconds of data.</span>') +
      "</div>" +
      '<div class="card"><h3>Alerts for this worker</h3>' +
      (d.alert_list.length
        ? '<div class="alerts">' +
          d.alert_list
            .slice()
            .reverse()
            .map(function (a) {
              return alertCard(
                Object.assign({ name: d.name, station: d.station }, a),
              );
            })
            .join("") +
          "</div>"
        : '<span class="muted small">None so far.</span>') +
      "</div>" +
      '<div class="acts"><button class="btn2 pri" data-act="live" data-w="' +
      d.id +
      '" type="button">Open in live monitor</button></div>';
  }

  /* ----- live monitor ----- */
  var CS = {};
  function cssv() {
    var c = getComputedStyle(document.documentElement);
    [
      "acc",
      "line",
      "mute",
      "ink",
      "bad",
      "ok",
      "cam",
      "camln",
      "hm1",
      "hm2",
      "acc2",
    ].forEach(function (k) {
      CS[k] = c.getPropertyValue("--" + k).trim();
    });
  }
  function buildLive() {
    var sel = $("lw");
    if (!sessions.length) return;
    if (!sel.options.length)
      sel.innerHTML = sessions
        .map(function (s, i) {
          return (
            '<option value="' +
            i +
            '">' +
            s.id +
            " · " +
            esc(s.name) +
            "</option>"
          );
        })
        .join("");
    sel.value = liveIdx;
    cssv();
  }
  function drawLive() {
    var e = engines[liveIdx],
      S0 = sessions[liveIdx];
    if (!e) return;
    var inf = lastInfo[liveIdx];
    cssv();
    var c = $("cam").getContext("2d");
    c.fillStyle = CS.cam;
    c.fillRect(0, 0, 440, 320);
    $("lcover").textContent = e.blocked ? "Uncover camera" : "Cover camera";
    $("lnote").textContent = e.blocked
      ? "Camera covered: this worker now runs on the wristband alone, so the result will differ from the Python reference."
      : "";
    if (!inf) {
      c.fillStyle = CS.mute;
      c.font = "14px sans-serif";
      c.fillText("Waiting for the first frame…", 20, 40);
    } else if (!inf.vis) {
      c.fillStyle = CS.mute;
      c.font = "15px sans-serif";
      c.textAlign = "center";
      c.fillText(
        e.blocked
          ? "Camera covered"
          : "Face not visible (safety glasses or turned away)",
        220,
        150,
      );
      c.fillText("Wristband only", 220, 176);
      c.textAlign = "left";
    } else {
      var L = inf.lm,
        sx = 2;
      c.strokeStyle = CS.camln;
      c.lineWidth = 2;
      c.fillStyle = CS.camln;
      [[0], [12]].forEach(function (o) {
        c.beginPath();
        for (var k = 0; k < 6; k++) {
          var x = L[o[0] + 2 * k] * sx,
            y = L[o[0] + 2 * k + 1] * sx;
          k ? c.lineTo(x, y) : c.moveTo(x, y);
        }
        c.closePath();
        c.stroke();
        for (k = 0; k < 6; k++) {
          c.beginPath();
          c.arc(L[o[0] + 2 * k] * sx, L[o[0] + 2 * k + 1] * sx, 3, 0, 7);
          c.fill();
        }
      });
      c.beginPath();
      for (var k2 = 0; k2 < 4; k2++) {
        var x2 = L[24 + 2 * k2] * sx,
          y2 = L[25 + 2 * k2] * sx;
        k2 ? c.lineTo(x2, y2) : c.moveTo(x2, y2);
      }
      c.closePath();
      c.stroke();
      var p = inf.patch,
        mn = 1e9,
        mx = -1e9,
        k3;
      for (k3 = 0; k3 < 576; k3++) {
        if (p[k3] < mn) mn = p[k3];
        if (p[k3] > mx) mx = p[k3];
      }
      var img = c.createImageData(24, 24);
      for (k3 = 0; k3 < 576; k3++) {
        var g = Math.round((255 * (p[k3] - mn)) / (mx - mn || 1));
        img.data[4 * k3] = g;
        img.data[4 * k3 + 1] = g;
        img.data[4 * k3 + 2] = g;
        img.data[4 * k3 + 3] = 255;
      }
      var t = document.createElement("canvas");
      t.width = 24;
      t.height = 24;
      t.getContext("2d").putImageData(img, 0, 0);
      c.imageSmoothingEnabled = false;
      c.drawImage(t, 350, 12, 80, 80);
      c.strokeStyle = CS.mute;
      c.lineWidth = 1;
      c.strokeRect(350, 12, 80, 80);
      c.fillStyle = CS.mute;
      c.font = "11px sans-serif";
      c.fillText("eye crop → CNN", 346, 106);
      c.fillStyle = CS.camln;
      c.font = "13px IBM Plex Mono,monospace";
      c.fillText(
        "EAR " + inf.ear.toFixed(2) + "   MAR " + inf.mar.toFixed(2),
        14,
        300,
      );
      c.fillText("CNN closed " + pc(inf.cp), 250, 300);
    }
    $("lcam").textContent =
      "frame " + e.i + " · " + (inf && inf.vis ? "face found" : "no face");
    var t2 = $("trace").getContext("2d");
    t2.clearRect(0, 0, 440, 110);
    t2.strokeStyle = CS.line;
    t2.lineWidth = 1;
    t2.strokeRect(0.5, 0.5, 439, 109);
    var n = Math.min(e.i, 150),
      y = function (v) {
        return 104 - (Math.min(0.5, Math.max(0, v)) / 0.5) * 98;
      };
    t2.setLineDash([4, 4]);
    t2.strokeStyle = CS.mute;
    t2.beginPath();
    t2.moveTo(0, y(0.2));
    t2.lineTo(440, y(0.2));
    t2.stroke();
    t2.setLineDash([]);
    t2.strokeStyle = CS.acc;
    t2.lineWidth = 2;
    t2.beginPath();
    var st = false;
    for (var q = 0; q < n; q++) {
      var ix = e.i - n + q;
      if (!e.vis[ix]) {
        st = false;
        continue;
      }
      var xx = (q / 149) * 440,
        yy = y(e.earlm[ix]);
      st ? t2.lineTo(xx, yy) : t2.moveTo(xx, yy);
      st = true;
    }
    t2.stroke();
    var r = e.last;
    var f = MODELS.fusion;
    if (!r) {
      $("lwin").textContent = "waiting for 10 s of data";
      $("fkv").innerHTML = "<span>Status</span><span>collecting</span>";
      $("wkv").innerHTML = "";
      $("psd").getContext("2d").clearRect(0, 0, 440, 130);
      return;
    }
    $("lwin").textContent = "check at " + fmt(r.s) + " · every 5 s";
    var sg = function (v) {
      return (v >= 0 ? "+" : "") + v.toFixed(2);
    };
    $("fkv").innerHTML =
      '<span>Camera model risk</span><span class="num">' +
      (r.ok ? pc(r.pv) : "no face · not used") +
      '</span><span>Wristband model risk</span><span class="num">' +
      pc(r.pw) +
      "</span>" +
      '<span>Camera term</span><span class="num">' +
      sg(f.coef[0] * r.fx[0]) +
      '</span><span>Wristband term</span><span class="num">' +
      sg(f.coef[1] * r.fx[1]) +
      '</span><span>Face-seen term</span><span class="num">' +
      sg(f.coef[2] * r.fx[2]) +
      '</span><span>Bias</span><span class="num">' +
      sg(f.intercept) +
      "</span>" +
      '<span>Sum → fused risk</span><span class="num"><b>' +
      sg(r.z) +
      " → " +
      pc(r.risk) +
      '</b></span><span>Rule</span><span>alert on after 2 checks ≥ 55%</span><span>Streak / state</span><span class="num">' +
      r.streak +
      "/2 · " +
      (r.alert ? "ALERT" : "no alert") +
      "</span>";
    $("wkv").innerHTML =
      '<span>Heart rate</span><span class="num">' +
      r.wf[0].toFixed(0) +
      " bpm (slope " +
      sg(r.wf[2]) +
      '/s)</span><span>SpO₂</span><span class="num">' +
      r.wf[3].toFixed(1) +
      '%</span><span>Motion strength</span><span class="num">' +
      r.wf[r.wf.length - 1].toFixed(3) +
      ' g</span><span>Dominant motion</span><span class="num">' +
      r.wf[8].toFixed(1) +
      " Hz</span>";
    var p2 = $("psd").getContext("2d");
    p2.clearRect(0, 0, 440, 130);
    var fs = r.psdf,
      ps = r.psd,
      top = 0,
      kk;
    for (kk = 0; kk < fs.length; kk++)
      if (fs[kk] <= 12 && ps[kk] > top) top = ps[kk];
    [
      [0.1, 0.8, ""],
      [0.8, 2, "0.8–2 Hz"],
      [2, 5, "2–5 Hz"],
      [5, 12, "5–12 Hz"],
    ].forEach(function (b, ix) {
      p2.fillStyle = ix % 2 ? CS.acc2 : "transparent";
      p2.fillRect((b[0] / 12) * 440, 0, ((b[1] - b[0]) / 12) * 440, 115);
      p2.fillStyle = CS.mute;
      p2.font = "10px sans-serif";
      p2.fillText(b[2], (b[0] / 12) * 440 + 3, 126);
    });
    p2.fillStyle = CS.acc;
    for (kk = 0; kk < fs.length; kk++) {
      if (fs[kk] > 12) break;
      var h = (ps[kk] / (top || 1)) * 108;
      p2.fillRect((fs[kk] / 12) * 440, 112 - h, 5, h);
    }
  }
  function renderResults() {
    var M = STAT.metrics,
      nm = {
        vision_only: "Camera only",
        wearable_only: "Wristband only",
        simple_average: "Simple average",
        learned_fusion: "Learned fusion",
      };
    var tab = function (o) {
      return (
        '<thead><tr><th>Model</th><th class="r">Accuracy</th><th class="r">Caught tired</th><th class="r">Missed tired</th><th class="r">Precision</th></tr></thead><tbody>' +
        Object.keys(o)
          .map(function (k) {
            var m = o[k];
            return (
              "<tr" +
              (k === "learned_fusion" ? ' style="font-weight:600"' : "") +
              "><td>" +
              nm[k] +
              '</td><td class="r num">' +
              pc(m.accuracy) +
              '</td><td class="r num">' +
              pc(m.recall) +
              '</td><td class="r num">' +
              pc(m.missed_fatigue_rate) +
              '</td><td class="r num">' +
              pc(m.precision) +
              "</td></tr>"
            );
          })
          .join("") +
        "</tbody>"
      );
    };
    $("mt").innerHTML = tab(M.all_windows);
    $("mt2").innerHTML = tab(M.face_lost_windows);
    var bars = function (o, id) {
      var ks = Object.keys(o)
        .sort(function (a, b) {
          return o[b] - o[a];
        })
        .slice(0, 7);
      $(id).innerHTML = ks
        .map(function (k) {
          return (
            '<div class="ibar"><span>' +
            k.replace(/_/g, " ") +
            '</span><div class="meter"><i style="width:' +
            (o[k] / o[ks[0]]) * 100 +
            '%"></i></div><span class="num">' +
            (o[k] * 100).toFixed(0) +
            "%</span></div>"
          );
        })
        .join("");
    };
    bars(STAT.wimp, "wimp");
    bars(STAT.vimp, "vimp");
  }
  var ITEMS = [
    ["Architecture design", 1, ""],
    ["Eye openness (EAR, MAR) from facial landmarks", 1, ""],
    ["Eye-state CNN", 1, "Trained on simulated eye images."],
    ["Camera and wristband models", 1, ""],
    ["Fusion and alert rule", 1, ""],
    [
      "Backend: API, alert database, audit log",
      1,
      "Python version tested; this page runs the same logic in the browser.",
    ],
    ["Frontend: multi-worker dashboard", 1, ""],
    [
      "Train the CNN on MRL Eye and YawDD",
      2,
      "Script ready and tested on stand-in images. Needs the dataset.",
    ],
    [
      "Train the wearable model on a real dataset",
      2,
      "Script ready. Needs the dataset.",
    ],
    ["Time the pipeline on a Raspberry Pi", 3, "Future work. Benchmark script is ready."],
    [
      "Build the wristband and camera unit",
      3,
      "Future work. Parts list, wiring and firmware are written.",
    ],
    [
      "Pilot study with volunteers",
      3,
      "Future work. Protocol and analysis are ready.",
    ],
  ];
  function renderSystem() {
    var scope = ITEMS.filter(function (i) {
      return i[1] !== 3;
    });                                   /* state 3 = future work, outside this review */
    var d = scope.filter(function (i) {
      return i[1] === 1;
    }).length;
    $("pct").textContent =
      d + " of " + scope.length + " done · " + Math.round((d / scope.length) * 100) + "%";
    $("items").innerHTML = ITEMS.map(function (i) {
      return (
        '<div class="st"><span>' +
        i[0] +
        (i[2] ? '<br><small class="muted">' + i[2] + "</small>" : "") +
        '</span><span class="tag ' +
        (i[1] === 1 ? "d" : i[1] === 3 ? "f" : "r") +
        '">' +
        (i[1] === 1 ? "Done" : i[1] === 3 ? "Future work" : "Ready to run") +
        "</span></div>"
      );
    }).join("");
  }
  function paintLog() {
    var hide = $("hide").checked;
    $("log").innerHTML =
      Server.log()
        .filter(function (l) {
          return !(hide && l.method === "POST" && l.path === "/api/readings");
        })
        .slice(0, 40)
        .map(function (l) {
          return (
            '<span class="' +
            (l.status < 300 ? "o" : "e") +
            '">' +
            l.status +
            "</span> " +
            fmt(l.t) +
            "  " +
            l.method.padEnd(4) +
            " " +
            esc(l.path) +
            "  " +
            l.ms.toFixed(1) +
            " ms"
          );
        })
        .join("\n") || "No requests yet.";
  }

  /* ----- events ----- */
  document.addEventListener("click", function (ev) {
    var t = ev.target.closest("[data-act],[data-nav],tr[data-w]");
    if (!t) {
      if (ev.target.id === "drawer") closeDrawer();
      return;
    }
    if (t.dataset.nav) {
      nav(t.dataset.nav);
      return;
    }
    if (t.tagName === "TR") {
      openDrawer(t.dataset.w);
      return;
    }
    var a = t.dataset.act;
    if (a === "open" || a === "openA") openDrawer(t.dataset.w);
    else if (a === "close") closeDrawer();
    else if (a === "restart") restart();
    else if (a === "wf") {
      wfilter = t.dataset.f;
      paintWorkers();
    } else if (a === "af") {
      afilter = t.dataset.f;
      paintAlerts();
    } else if (a === "live") {
      liveIdx = sessions.findIndex(function (s) {
        return s.id === t.dataset.w;
      });
      closeDrawer();
      nav("live");
    } else if (a === "ack")
      API("POST", "/api/alerts/" + t.dataset.id + "/ack", {
        by: "Supervisor",
      }).then(refresh);
    else if (a === "res")
      API("POST", "/api/alerts/" + t.dataset.id + "/resolve", {
        by: "Supervisor",
        outcome: t.dataset.o,
        break: !!t.dataset.b,
      }).then(refresh);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeDrawer();
  });
  $("q").addEventListener("input", paintWorkers);
  $("hide").addEventListener("change", paintLog);
  $("bplay").addEventListener("click", function () {
    if (ended) return;
    playing = !playing;
    setPlayLabel();
  });
  $("brestart").addEventListener("click", restart);
  $("speed").addEventListener("change", function (e) {
    speed = +e.target.value;
  });
  $("lw").addEventListener("change", function (e) {
    liveIdx = +e.target.value;
  });
  $("lcover").addEventListener("click", function () {
    var e = engines[liveIdx];
    API("POST", "/api/workers/" + sessions[liveIdx].id + "/camera", {
      covered: !e.blocked,
    }).then(function (r) {
      if (r.status === 200) e.blocked = !e.blocked;
    });
  });
  $("bcsv").addEventListener("click", function () {
    API("GET", "/api/report").then(function (r) {
      $("csv").value = r.data.csv;
      $("csv").hidden = false;
      $("bcopy").hidden = false;
    });
  });
  $("bcopy").addEventListener("click", function () {
    var t = $("csv");
    t.select();
    try {
      navigator.clipboard.writeText(t.value).catch(function () {
        document.execCommand("copy");
      });
    } catch (e) {
      try {
        document.execCommand("copy");
      } catch (e2) {}
    }
    $("bcopy").textContent = "Copied";
    setTimeout(function () {
      $("bcopy").textContent = "Copy";
    }, 1500);
  });
  $("bver").addEventListener("click", function () {
    API("GET", "/api/verify").then(function (r) {
      var d = r.data;
      $("ver").innerHTML = d.decisions_checked
        ? "<b>" +
          d.matching +
          " of " +
          d.decisions_checked +
          "</b> stored decisions match the Python reference (largest difference " +
          d.max_abs_difference.toExponential(1) +
          ").<br>Alert start events: <b>" +
          d.alert_events_matching +
          " of " +
          d.alert_events_expected +
          "</b> match." +
          (d.excluded_workers.length
            ? "<br>Left out because the camera was covered during the test: " +
              d.excluded_workers.join(", ") +
              "."
            : "") +
          (d.decisions_checked < 500
            ? '<br><span class="muted">The shift is still running, so more decisions will be checked once it finishes.</span>'
            : "")
        : "No decisions have been stored yet. Start the shift and try again in a few seconds.";
    });
  });
  $("rs").addEventListener("click", function () {
    var b = null,
      t = $("rb").value.trim();
    if (t) {
      try {
        b = JSON.parse(t);
      } catch (e) {
        $("rr").textContent = "The body is not valid JSON.";
        return;
      }
    }
    API($("rm").value, $("rp").value.trim(), b).then(function (r) {
      $("rr").innerHTML =
        '<span class="' +
        (r.status < 300 ? "o" : "e") +
        '">HTTP ' +
        r.status +
        "</span>\n" +
        esc(JSON.stringify(r.data, null, 1).slice(0, 2500));
      paintLog();
    });
  });
  matchMedia("(prefers-color-scheme:dark)").addEventListener &&
    matchMedia("(prefers-color-scheme:dark)").addEventListener("change", cssv);

  /* ----- hooks for person.js (the animated worker) ----- */
  window.FM_HOOK = function () {
    var e = engines[liveIdx],
      S0 = sessions[liveIdx];
    if (!e || !S0) return null;
    var inf = lastInfo[liveIdx] || {},
      rec = e.last,
      sec = Math.max(0, Math.min(S0.n_s - 1, Math.floor(simT)));
    return {
      idx: liveIdx,
      id: S0.id,
      name: S0.name,
      role: S0.role,
      station: S0.station,
      t: simT,
      playing: playing,
      ended: ended,
      speed: speed,
      ear: inf.ear == null ? null : inf.ear,
      mar: inf.mar == null ? null : inf.mar,
      vis: inf.vis == null ? null : inf.vis,
      blocked: e.blocked,
      hr: S0.hr[sec] / 10,
      spo: S0.spo[sec] / 100,
      risk: rec ? rec.risk : null,
      alert: rec ? rec.alert : false,
    };
  };
  window.FM_API = API;
  window.FM_ENGINE = function () {
    return { Engine: Core.Engine, models: MODELS, session: sessions[0] };
  };
  window.FM_SIM = function () {
    return { t: simT, playing: playing, speed: speed, ended: ended };
  };
  window.FM_HOOK.list = function () {
    return sessions.map(function (s) {
      return { id: s.id, name: s.name };
    });
  };
  window.FM_HOOK.setWorker = function (i) {
    liveIdx = i;
    $("lw").value = i;
  };
  window.FM_HOOK.nextAlert = function () {
    for (var k = 1; k <= engines.length; k++) {
      var i = (liveIdx + k) % engines.length;
      if (engines[i].last && engines[i].last.alert) return i;
    }
    return -1;
  };

  /* ----- start ----- */
  async function boot() {
    try {
      if (typeof DecompressionStream === "undefined")
        throw new Error(
          "This browser cannot unpack the data. Open the page in a current version of Chrome, Edge, Safari or Firefox.",
        );
      var bin = atob($("blob").textContent.trim()),
        u8 = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      var buf = await new Response(
        new Blob([u8]).stream().pipeThrough(new DecompressionStream("gzip")),
      ).arrayBuffer();
      sessions = Core.views(buf, MAN);
    } catch (e) {
      $("loading").textContent = "The app could not start. " + e.message;
      return;
    }
    $("loading").hidden = true;
    makeEngines();
    var h = (location.hash || "").slice(1);
    view = TITLE[h] ? h : "dash";
    playing = !REDUCED;
    setPlayLabel();
    if (REDUCED) $("bplay").textContent = "Start";
    nav(view);
    setInterval(function () {
      if (playing || (view === "dash" && !ended)) refresh();
    }, 500);
    requestAnimationFrame(function (t) {
      prev = t;
      loop(t);
    });
  }
  boot();
})();
