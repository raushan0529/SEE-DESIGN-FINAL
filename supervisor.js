/* Supervisor screen: how an alert is handled, as an animation driven by the real alert queue.
 *
 *   1 alert raised -> 2 supervisor notified (tablet buzzes) -> 3 acknowledged (API call) -> 4 walks to the worker
 *   -> 5 check-in talk -> 6 decision applied (API call) -> 7 case closed
 *
 * The two buttons really call the backend routes /api/alerts/<id>/ack and /api/alerts/<id>/resolve, so the Alerts screen,
 * the audit log and the CSV report show what you did here. app.js provides window.FM_API and window.FM_SIM.
 * An alert that nobody acknowledges within ESCALATE_AFTER shift-seconds is shown as escalated to the manager.
 */
(function () {
  "use strict";
  var root = document.getElementById("supRoot");
  if (!root || !window.FM_API) return;

  var ESCALATE_AFTER = 60;                                   // shift seconds
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var clamp = function (x, a, b) { return Math.max(a, Math.min(b, x)); };
  var lerp = function (a, b, k) { return a + (b - a) * k; };
  var fmt = function (s) { s = Math.max(0, Math.floor(s)); return ("0" + Math.floor(s / 60)).slice(-2) + ":" + ("0" + (s % 60)).slice(-2); };

  var DECISIONS = [
    { key: "rest", text: "Rest break, 10 minutes", brk: true, say: "Please take a 10-minute rest.", reply: "Thanks, I will rest." },
    { key: "light", text: "Move to a lighter task", brk: true, say: "Switch to a lighter task for now.", reply: "OK, moving to packing." },
    { key: "health", text: "Send for a health check", brk: true, say: "Let us get you checked at first aid.", reply: "Yes, that is better." },
    { key: "false", text: "False alarm, worker is fine", brk: false, say: "You look fine. Carry on, I will re-check.", reply: "I am fine, thank you." }
  ];
  var SOP = [
    ["Acknowledge", "Press Acknowledge within 60 s. After 60 s the alert is escalated to the manager."],
    ["Go to the worker", "Walk to the station. Do not call from far away: look at the person."],
    ["Check in", "Ask how they feel. Look for closed eyes, yawning, slow movement."],
    ["Decide", "Rest break, lighter task, health check, or false alarm."],
    ["Record", "Close the case with the outcome. It goes to the audit log and the report."],
    ["Re-check", "After the break the risk should fall below 45%. If not, escalate."]
  ];

  /* ---------- layout ---------- */
  root.innerHTML =
    '<div class="grid kpis" id="supK"></div>' +
    '<div class="grid two">' +
    '<div class="card"><h3>Control room and floor <span class="small muted" id="supWho"></span></h3>' +
    '<div class="scene-box"><svg id="supSvg" viewBox="0 0 760 300" role="img" aria-label="Animated supervisor handling a fatigue alert"></svg></div>' +
    '<div class="note" id="supSay" style="margin-top:10px">Waiting for an alert.</div></div>' +
    '<div class="card"><h3>Current case</h3><div id="supCase" class="small"></div>' +
    '<div class="tools" style="margin:10px 0 6px"><button class="btn2 pri" id="supAck" type="button">1 · Acknowledge</button></div>' +
    '<div id="supVit" class="small" style="margin:6px 0"></div>' +
    '<div class="req" style="grid-template-columns:minmax(0,1fr) auto"><select id="supDec" aria-label="Decision"></select><button class="btn2 pri" id="supApply" type="button">2 · Apply decision</button></div>' +
    '<input id="supNote" placeholder="Supervisor note (saved with the outcome)" aria-label="Supervisor note" style="width:100%;margin:6px 0;padding:6px 10px;border:1px solid var(--line);border-radius:6px;background:var(--sf);color:var(--ink)">' +
    '<div class="tools" style="margin:6px 0 0"><button class="btn2" id="supMgr" type="button">Escalate to manager now</button><button class="btn2" id="supAuto" type="button">Handle automatically</button></div>' +
    '<div class="tools" style="margin:0"><button class="btn2" id="supFast" type="button">Run shift to next alert</button><button class="btn2" id="supRes" type="button">Pause / resume shift</button><label class="small"><input type="checkbox" id="supPause" checked> pause when an alert arrives</label></div>' +
    '<ol class="steps" id="supSteps"></ol></div></div>' +
    '<div class="grid two" style="margin-top:14px"><div class="card"><h3>Alert queue <select id="supFil" aria-label="Filter" style="float:right;font-size:12px"><option value="all">All</option><option value="open">Open</option><option value="acknowledged">Acknowledged</option><option value="resolved">Closed</option></select></h3><div class="scroll"><table class="t"><thead><tr><th>Alert</th><th>Worker</th><th class="r">Raised</th><th class="r">Waiting</th><th>Status</th><th></th></tr></thead><tbody id="supQ"></tbody></table></div></div>' +
    '<div class="card"><h3>Shift summary</h3><div id="supHist" class="small"></div></div>' +
    '<div class="card"><h3>Suggested procedure for a supervisor</h3><ol class="sop" id="supSop"></ol>' +
    '<p class="small muted" style="margin:8px 0 0">This is the procedure used in this project. In the replay the recorded worker keeps the same data; in a real plant the risk should drop after the break.</p></div></div>';

  $("supDec").innerHTML = DECISIONS.map(function (d, i) { return '<option value="' + i + '">' + d.text + "</option>"; }).join("");
  $("supSop").innerHTML = SOP.map(function (s) { return "<li><b>" + s[0] + ".</b> " + s[1] + "</li>"; }).join("");

  /* ---------- state ---------- */
  var fast = false, fastBase = 0, lastN = 0, vit = null, vitId = "", filt = "all", alerts = [], stats = null, cur = null, auto = false, busy = false;
  var P = { notify: 0, acked: 1, walk: 2, talk: 3, decide: 4, brk: 5, done: 6 };
  var now = function () { return performance.now() / 1000; };
  function setPhase(ph) { cur.phase = ph; cur.t0 = now(); }
  var simT = function () { return window.FM_SIM().t; };

  function pick() {
    if (cur && cur.phase !== "done") return;
    var byAge = function (st) { var l = alerts.filter(function (a) { return a.status === st; }); return l[l.length - 1]; };   // oldest first
    var next = byAge("open") || byAge("acknowledged");
    if (next && (!cur || cur.id !== next.id)) choose(next);
  }
  function choose(a) {
    cur = { id: a.id, phase: a.status === "open" ? "notify" : a.status === "acknowledged" ? "acked" : "done", t0: now(), dec: DECISIONS[0], a: a };
    if (a.status === "resolved") { cur.t0 = now() - 99; cur.dec = guess(a.outcome); }
  }
  function guess(o) { o = (o || "").toLowerCase(); return DECISIONS.filter(function (d) { return o.indexOf(d.text.toLowerCase().slice(0, 8)) === 0; })[0] || DECISIONS[0]; }

  function poll() {
    if (!root.offsetParent) return;
    Promise.all([window.FM_API("GET", "/api/alerts"), window.FM_API("GET", "/api/stats")]).then(function (r) {
      alerts = r[0].data; stats = r[1].data;
      if (alerts.length > lastN && lastN >= 0 && $("supPause").checked && window.FM_SIM().playing) $("bplay").click();
      lastN = alerts.length;
      if (cur && cur.a && cur.phase !== "done") window.FM_API("GET", "/api/workers/" + cur.a.worker).then(function (r) { vit = r.data; vitId = cur && cur.a && cur.a.worker; });
      if (fast && alerts.length > fastBase) { fast = false; var sp = $("speed"); sp.value = "3"; sp.dispatchEvent(new Event("change")); }
      if (cur) {
        var a = alerts.filter(function (x) { return x.id === cur.id; })[0];
        if (a) {
          cur.a = a;
          if (cur.phase === "notify" && a.status !== "open") setPhase("acked");
          if (cur.phase !== "done" && cur.phase !== "brk" && a.status === "resolved") { cur.dec = guess(a.outcome); setPhase("brk"); }
        }
      }
      pick(); paintPanel();
    });
  }
  setInterval(poll, 700);

  /* ---------- actions ---------- */
  function doAck() {
    if (!cur || cur.phase !== "notify" || busy) return;
    busy = true;
    window.FM_API("POST", "/api/alerts/" + cur.id + "/ack", { by: "Supervisor" }).then(function () { busy = false; setPhase("acked"); poll(); });
  }
  function doApply() {
    if (!cur || cur.phase !== "decide" || busy) return;
    busy = true;
    var d = auto ? DECISIONS[0] : DECISIONS[+$("supDec").value];
    cur.dec = d;
    window.FM_API("POST", "/api/alerts/" + cur.id + "/resolve", { by: "Supervisor", outcome: d.text + ($("supNote").value.trim() ? " - " + $("supNote").value.trim() : "") + (cur.mgr ? " (manager informed)" : ""), break: d.brk }).then(function () { busy = false; $("supNote").value = ""; setPhase("brk"); poll(); });
  }
  $("supAck").addEventListener("click", function () { auto = false; doAck(); });
  $("supApply").addEventListener("click", function () { auto = false; doApply(); });
  $("supAuto").addEventListener("click", function () { auto = !auto; $("supAuto").textContent = auto ? "Stop automatic handling" : "Handle automatically"; });
  $("supFast").addEventListener("click", function () {
    fast = true; fastBase = alerts.length;
    var sp = $("speed"); sp.value = "10"; sp.dispatchEvent(new Event("change"));
    var b = $("bplay"); if (!window.FM_SIM().playing && !window.FM_SIM().ended) b.click();
  });
  $("supMgr").addEventListener("click", function () { if (cur && cur.phase !== "done") { cur.mgr = true; } });
  $("supRes").addEventListener("click", function () { $("bplay").click(); });
  $("supFil").addEventListener("change", function (e) { filt = e.target.value; paintPanel(); });
  $("supQ").addEventListener("click", function (e) {
    var id = e.target.dataset && e.target.dataset.h; if (!id) return;
    var a = alerts.filter(function (x) { return x.id === id; })[0]; if (a) choose(a);
  });

  /* ---------- panels ---------- */
  function spark(a) { if (!a || !a.length) return ""; var w = 70, h = 16, p = a.map(function (r, i) { return (i * w / Math.max(1, a.length - 1)).toFixed(1) + "," + (h - 2 - (r || 0) * (h - 4)).toFixed(1); }).join(" "); return '<svg width="' + w + '" height="' + h + '" style="vertical-align:middle"><polyline points="' + p + '" fill="none" stroke="var(--acc)" stroke-width="1.5"/></svg>'; }
  function ageOf(a) { var end = a.status === "open" ? simT() : a.ackT != null ? a.ackT : simT(); return Math.max(0, end - a.t); }
  var escalated = function (a) { return a.status === "open" && simT() - a.t > ESCALATE_AFTER; };

  function paintPanel() {
    var open = alerts.filter(function (a) { return a.status === "open"; }).length;
    var ack = alerts.filter(function (a) { return a.status === "acknowledged"; }).length;
    var closed = alerts.filter(function (a) { return a.status === "resolved"; }).length;
    var esc_ = alerts.filter(escalated).length;
    var kp = function (n, l, c) { return '<div class="card kpi ' + (c || "") + '"><b>' + n + "</b><span>" + l + "</span></div>"; };
    $("supK").innerHTML = kp(open, "open, waiting for you", open ? "bad" : "") + kp(ack, "acknowledged, being handled", ack ? "wa" : "") + kp(closed, "closed") +
      kp(stats && stats.mean_ack_delay_s != null ? Math.round(stats.mean_ack_delay_s) + " s" : "-", "average time to acknowledge") + kp(esc_, "escalated to manager (over " + ESCALATE_AFTER + " s)", esc_ ? "bad" : "");
    var shown = alerts.filter(function (a) { return filt === "all" || a.status === filt; });
    $("supQ").innerHTML = shown.length ? shown.map(function (a) {
      return "<tr><td>" + a.id + "</td><td>" + esc(a.name) + '<br><span class="small muted">' + esc(a.station) + "</span></td><td class=\"r num\">" + fmt(a.t) + '</td><td class="r num">' + Math.round(ageOf(a)) + " s</td><td>" +
        '<span class="pill ' + a.status + '">' + a.status + "</span>" + (escalated(a) ? ' <span class="pill alert">escalated</span>' : "") + '</td><td><button class="btn2" data-h="' + a.id + '" type="button">' + (cur && cur.id === a.id ? "Showing" : "Show") + "</button></td></tr>";
    }).join("") : '<tr><td colspan="6" class="muted">No alerts here. Press "Run shift to next alert".</td></tr>';
    var ph = cur ? P[cur.phase] : -1, a = cur && cur.a;
    $("supAck").disabled = !(cur && cur.phase === "notify");
    $("supApply").disabled = !(cur && cur.phase === "decide");
    $("supDec").disabled = !(cur && cur.phase === "decide");
    $("supCase").innerHTML = a ? "<b>" + esc(a.name) + "</b> · " + esc(a.role) + ", " + esc(a.station) + "<br>Alert " + a.id + " raised at " + fmt(a.t) + ", risk " + Math.round(a.risk * 100) + "% (peak " + Math.round(a.peak * 100) + "%). Basis: " + esc(a.basis) + "." +
      (escalated(a) ? '<br><b style="color:var(--bad)">Not acknowledged for over ' + ESCALATE_AFTER + " s: escalated to the manager.</b>" : "") : "No case selected. When the system raises an alert it appears here.";
    var v = vit && cur && a && vitId === a.worker ? vit : null;
    $("supVit").innerHTML = v ? "<b>Live now:</b> risk " + (v.risk == null ? "-" : Math.round(v.risk * 100) + "%") + " · heart rate " + (v.hr == null ? "-" : Math.round(v.hr)) + " · SpO2 " + (v.spo2 == null ? "-" : Math.round(v.spo2)) + " · status " + esc(v.status) + (v.breakOrdered ? " · break ordered" : "") + " " + spark(v.spark) : "";
    var by = {}, tc = 0, nc = 0;
    alerts.filter(function (x) { return x.status === "resolved"; }).forEach(function (x) { var k = (x.outcome || "other").split(" - ")[0]; by[k] = (by[k] || 0) + 1; if (x.closedT != null) { tc += x.closedT - x.t; nc++; } });
    var tot = closed || 1;
    $("supHist").innerHTML = (closed ? Object.keys(by).map(function (k) { return '<div style="margin:3px 0">' + esc(k) + " · <b>" + by[k] + '</b><div class="pbar"><i style="width:' + Math.round(by[k] / tot * 100) + '%"></i></div></div>'; }).join("") +
      "<div style=\"margin-top:6px\">Average time from alert to closed case: <b>" + (nc ? Math.round(tc / nc) + " s" : "-") + "</b></div>" : "No cases closed yet.") + "<div>Workers on break because of alerts: <b>" + (stats ? alerts.filter(function (x) { return x.status === "resolved" && /rest|lighter|health/i.test(x.outcome || ""); }).length : 0) + "</b></div>";
    var steps = [
      ["Alert raised", a ? fmt(a.t) + ", risk " + Math.round(a.risk * 100) + "%" : ""],
      ["Supervisor notified", "tablet buzzes"],
      ["Acknowledged", a && a.ackT != null ? fmt(a.ackT) + ", after " + Math.round(a.ackT - a.t) + " s" : ""],
      ["Reached the worker", ""],
      ["Check-in talk", ""],
      ["Decision applied", a && a.outcome ? esc(a.outcome) : ""],
      ["Case closed", a && a.closedT != null ? fmt(a.closedT) : ""]
    ];
    var done = [a ? 1 : 0, ph >= 0 ? 1 : 0, ph >= 1 ? 1 : 0, ph >= 3 ? 1 : 0, ph >= 4 ? 1 : 0, ph >= 5 ? 1 : 0, ph >= 6 ? 1 : 0];
    $("supSteps").innerHTML = steps.map(function (s, i) {
      return '<li class="' + (done[i] ? "ok" : "") + '"><b>' + s[0] + "</b>" + (s[1] ? ' <span class="muted">' + s[1] + "</span>" : "") + "</li>";
    }).join("");
    $("supWho").textContent = a ? a.id + " · " + a.name : "";
  }

  /* ---------- drawing ---------- */
  var SKIN = "#f1c27d";
  function fig(x, o) {
    var y = 250, d = o.dir || 1, sit = !!o.sit, sw = o.walk == null ? 0 : Math.sin(o.walk) * 0.6;
    var hip = y - 44 + (sit ? 20 : 0), s = "";
    if (sit) {
      s += '<path d="M' + x + " " + hip + " L" + (x + d * 26) + " " + hip + " L" + (x + d * 26) + " " + (y - 2) + '" fill="none" stroke="#1e3a5f" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>';
    } else {
      s += '<line x1="' + (x - 5) + '" y1="' + hip + '" x2="' + (x - 5 + Math.sin(sw) * 22) + '" y2="' + y + '" stroke="#1e3a5f" stroke-width="9" stroke-linecap="round"/>' +
        '<line x1="' + (x + 5) + '" y1="' + hip + '" x2="' + (x + 5 - Math.sin(sw) * 22) + '" y2="' + y + '" stroke="#1e3a5f" stroke-width="9" stroke-linecap="round"/>';
    }
    var tilt = o.tired ? 5 : 0;
    s += '<rect x="' + (x - 13) + '" y="' + (hip - 44) + '" width="26" height="46" rx="8" fill="' + o.shirt + '"/>';
    if (o.vest) s += '<rect x="' + (x - 13) + '" y="' + (hip - 40) + '" width="26" height="40" rx="6" fill="#f28c28"/><rect x="' + (x - 13) + '" y="' + (hip - 22) + '" width="26" height="4" fill="#e5e7eb"/>';
    // arms
    var ax = o.walk == null ? 0 : Math.sin(sw * 1.0) * 10;
    if (o.tablet) {
      s += '<line x1="' + (x + d * 10) + '" y1="' + (hip - 36) + '" x2="' + (x + d * 22) + '" y2="' + (hip - 20) + '" stroke="' + o.shirt + '" stroke-width="8" stroke-linecap="round"/>' +
        '<rect x="' + (x + d * 20 - 7) + '" y="' + (hip - 30) + '" width="14" height="19" rx="2" fill="#0f172a" stroke="#94a3b8"/><rect x="' + (x + d * 20 - 5) + '" y="' + (hip - 28) + '" width="10" height="13" fill="' + (o.screen || "#22c55e") + '"/>';
    } else if (o.cup) {
      s += '<line x1="' + (x + d * 10) + '" y1="' + (hip - 36) + '" x2="' + (x + d * 20) + '" y2="' + (hip - 24) + '" stroke="' + o.shirt + '" stroke-width="8" stroke-linecap="round"/>' +
        '<rect x="' + (x + d * 20 - 5) + '" y="' + (hip - 32) + '" width="10" height="11" rx="2" fill="#fff" stroke="#94a3b8"/>';
    } else {
      s += '<line x1="' + (x - 12) + '" y1="' + (hip - 36) + '" x2="' + (x - 14 - ax) + '" y2="' + (hip - 8) + '" stroke="' + o.shirt + '" stroke-width="8" stroke-linecap="round"/>' +
        '<line x1="' + (x + 12) + '" y1="' + (hip - 36) + '" x2="' + (x + 14 + ax) + '" y2="' + (hip - 8) + '" stroke="' + o.shirt + '" stroke-width="8" stroke-linecap="round"/>';
    }
    // head
    var hx = x + tilt * d, hy = hip - 58 + (o.tired ? 4 : 0);
    s += '<circle cx="' + hx + '" cy="' + hy + '" r="12" fill="' + SKIN + '"/>' +
      '<path d="M' + (hx - 13) + " " + (hy - 2) + " A13 12 0 0 1 " + (hx + 13) + " " + (hy - 2) + " Z\" fill=\"" + o.hat + '"/><rect x="' + (hx - 15) + '" y="' + (hy - 3) + '" width="30" height="4" rx="2" fill="' + o.hat + '" opacity=".85"/>';
    if (o.tired) s += '<path d="M' + (hx - 6 + d * 2) + " " + (hy + 1) + " h4 M" + (hx + 3 + d * 2) + " " + (hy + 1) + ' h4" stroke="#3b2a1a" stroke-width="1.6" stroke-linecap="round"/><path d="M' + (hx - 3 + d * 2) + " " + (hy + 8) + ' q4 -2 8 0" stroke="#7a2e2e" fill="none" stroke-width="1.6"/>';
    else s += '<circle cx="' + (hx - 4 + d * 2) + '" cy="' + (hy + 1) + '" r="1.7" fill="#222"/><circle cx="' + (hx + 4 + d * 2) + '" cy="' + (hy + 1) + '" r="1.7" fill="#222"/><path d="M' + (hx - 3 + d * 2) + " " + (hy + 7) + ' q3 2 6 0" stroke="#7a2e2e" fill="none" stroke-width="1.4"/>';
    return s;
  }
  function bubble(x, y, text, who) {
    var lines = []; var words = String(text).split(" "), l = "";
    words.forEach(function (w) { if ((l + " " + w).length > 26) { lines.push(l); l = w; } else l = (l ? l + " " : "") + w; }); lines.push(l);
    var w = Math.max.apply(null, lines.map(function (t) { return t.length; })) * 6.4 + 16, h = lines.length * 15 + 10, bx = clamp(x - w / 2, 4, 756 - w);
    return '<g><rect x="' + bx + '" y="' + (y - h) + '" width="' + w + '" height="' + h + '" rx="8" fill="var(--sf)" stroke="' + (who === "w" ? "#f28c28" : "var(--acc)") + '" stroke-width="1.6"/>' +
      '<path d="M' + (x - 5) + " " + y + " l5 7 l5 -7 z\" fill=\"var(--sf)\" stroke=\"" + (who === "w" ? "#f28c28" : "var(--acc)") + '" stroke-width="1.6"/><rect x="' + (x - 4) + '" y="' + (y - 2) + '" width="8" height="3" fill="var(--sf)"/>' +
      lines.map(function (t, i) { return '<text x="' + (bx + 8) + '" y="' + (y - h + 17 + i * 15) + '" font-size="11.5" fill="var(--ink)">' + esc(t) + "</text>"; }).join("") + "</g>";
  }

  var SX0 = 235, SXW = 492, WX = 585, BX = 700;           // supervisor desk, supervisor at worker, worker station, bench
  function frame() {
    requestAnimationFrame(frame);
    if (!root.offsetParent) return;
    var t = now(), el = cur ? t - cur.t0 : 0, ph = cur ? cur.phase : "idle";
    var a = cur && cur.a;
    var first = a ? a.name.split(" ")[0] : "worker", dec = cur ? cur.dec : DECISIONS[0];
    // automatic transitions
    if (cur) {
      if (ph === "acked" && el > 0.8) setPhase("walk");
      else if (ph === "walk" && el > 3) setPhase("talk");
      else if (ph === "talk" && el > 3.2) setPhase("decide");
      else if (ph === "brk" && el > 6.5) setPhase("done");
      if (auto && ph === "notify" && el > 1.5) doAck();
      if (auto && ph === "decide" && el > 2) doApply();
      ph = cur.phase; el = t - cur.t0;
    }
    // positions
    var sx = SX0, sWalk = null, wx = WX, wWalk = null, wSit = false, sdir = 1, wdir = -1;
    if (ph === "walk") { var k = clamp(el / 3, 0, 1); sx = lerp(SX0, SXW, k); sWalk = t * 9; }
    else if (ph === "talk" || ph === "decide") sx = SXW;
    else if (ph === "brk") {
      sx = SXW;
      if (dec.key === "rest" || dec.key === "health") { var kk = clamp(el / 2.5, 0, 1); wx = lerp(WX, BX, kk); if (kk < 1) wWalk = t * 9; else wSit = true; }
    } else if (ph === "done") {
      var back = clamp(el / 3, 0, 1); sx = lerp(SXW, SX0, back); if (back < 1) { sWalk = t * 9; sdir = -1; }
      if (dec.key === "rest" || dec.key === "health") { wx = BX; wSit = true; }
    }
    if (ph === "brk" && wWalk != null) wdir = 1;
    var wTired = cur && (ph === "notify" || ph === "acked" || ph === "walk" || ph === "talk" || ph === "decide" || (ph === "brk" && wWalk == null && !wSit && dec.key !== "false")) ;
    if (ph === "done" || (ph === "brk" && dec.key === "false")) wTired = false;
    var alertOn = cur && ph !== "done" && ph !== "brk";
    var esc_ = a && (escalated(a) || cur.mgr) && ph !== "done";

    var s = "";
    // room
    s += '<rect width="760" height="250" fill="var(--sf2)"/><rect y="250" width="760" height="50" fill="var(--line)"/><rect y="248" width="760" height="4" fill="#f2c200"/>' +
      '<text x="20" y="24" font-size="12" font-weight="600" fill="var(--mute)">CONTROL ROOM</text><text x="500" y="24" font-size="12" font-weight="600" fill="var(--mute)">WORKSTATION</text><text x="660" y="24" font-size="12" font-weight="600" fill="var(--mute)">' + (dec.key === "health" ? "FIRST AID" : "BREAK AREA") + "</text>" +
      '<line x1="445" y1="35" x2="445" y2="248" stroke="var(--line)" stroke-dasharray="4 5"/>';
    // desk, monitor, phone
    var blink = Math.sin(t * 7) > 0, red = alertOn && ph === "notify";
    s += '<rect x="30" y="205" width="170" height="10" rx="3" fill="#6b7280"/><rect x="40" y="215" width="8" height="35" fill="#6b7280"/><rect x="182" y="215" width="8" height="35" fill="#6b7280"/>' +
      '<rect x="70" y="150" width="96" height="56" rx="5" fill="#111827" stroke="' + (red && blink ? "#ef4444" : "#475569") + '" stroke-width="3"/><rect x="108" y="206" width="20" height="0" fill="#475569"/>' +
      '<text x="118" y="170" text-anchor="middle" font-size="11" font-weight="700" fill="' + (alerts.some(function (x) { return x.status !== "resolved"; }) ? "#f87171" : "#4ade80") + '">' + (alerts.some(function (x) { return x.status !== "resolved"; }) ? "ALERT QUEUE" : "ALL CLEAR") + "</text>" +
      alerts.filter(function (x) { return x.status !== "resolved"; }).slice(0, 3).map(function (x, i) { return '<text x="78" y="' + (184 + i * 11) + '" font-size="9.5" fill="#cbd5e1">' + esc(x.name.slice(0, 14)) + " " + Math.round(x.risk * 100) + "%</text>"; }).join("");
    var buzz = ph === "notify" ? Math.sin(t * 50) * 1.5 : 0;
    s += '<rect x="' + (172 + buzz) + '" y="196" width="16" height="9" rx="2" fill="#0f172a" stroke="#94a3b8"/>';
    if (ph === "notify") for (var r = 0; r < 2; r++) { var f = (t * 1.4 + r * 0.5) % 1; s += '<circle cx="180" cy="200" r="' + (8 + 22 * f) + '" fill="none" stroke="#ef4444" stroke-width="2" opacity="' + (1 - f).toFixed(2) + '"/>'; }
    // manager
    if (esc_) s += '<circle cx="40" cy="70" r="11" fill="' + SKIN + '"/><path d="M27 68 A13 11 0 0 1 53 68 Z" fill="#111827"/><text x="40" y="104" text-anchor="middle" font-size="10" fill="var(--mute)">Manager</text>' + bubble(150, 80, (cur.mgr ? "Manager informed by supervisor." : "No answer for 60 s. Manager called."), "s");
    // workstation + bench
    s += '<rect x="510" y="228" width="150" height="14" rx="3" fill="#4b5563"/><rect x="510" y="242" width="150" height="8" fill="#374151"/>';
    s += '<rect x="662" y="222" width="86" height="10" rx="3" fill="#8b5e3c"/><rect x="668" y="232" width="7" height="18" fill="#8b5e3c"/><rect x="735" y="232" width="7" height="18" fill="#8b5e3c"/>';
    // worker
    s += fig(wx, { shirt: "#2f5d9e", vest: true, hat: "#f5c400", walk: wWalk, sit: wSit, dir: wdir, tired: wTired, cup: wSit });
    if (wSit) { var pr = clamp((el - 2.5) / 4, 0, 1); s += '<rect x="662" y="200" width="70" height="7" rx="3" fill="var(--line)"/><rect x="662" y="200" width="' + (70 * pr).toFixed(1) + '" height="7" rx="3" fill="#22c55e"/><text x="697" y="196" text-anchor="middle" font-size="10" fill="var(--mute)">recovering</text>'; }
    if (alertOn) s += '<g opacity="' + (Math.sin(t * 6) > -0.3 ? 1 : 0.2) + '"><path d="M' + wx + " 106 l14 24 h-28 z\" fill=\"#ef4444\" stroke=\"#fff\" stroke-width=\"1.5\"/><text x=\"" + wx + '" y="127" text-anchor="middle" font-size="14" font-weight="700" fill="#fff">!</text></g>';
    if (cur && (ph === "done" || (ph === "brk" && dec.key === "false"))) s += '<text x="' + wx + '" y="116" text-anchor="middle" font-size="20" fill="#22c55e">✓</text>';
    // supervisor
    s += fig(sx, { shirt: "#0f766e", hat: "#ffffff", walk: sWalk, dir: sdir, tablet: sWalk != null || ph !== "idle", screen: red ? "#ef4444" : "#22c55e" });
    // bubbles
    var say = "Waiting for an alert.", bx = sx, by = 140, who = "s";
    if (ph === "notify") say = "Alert: " + a.name + ", risk " + Math.round(a.risk * 100) + "%. I must acknowledge.";
    else if (ph === "acked") say = "Acknowledged. Going to " + a.station + ".";
    else if (ph === "walk") say = "On my way.";
    else if (ph === "talk") { if (el < 1.5) say = "Are you OK, " + first + "?"; else { say = "I feel very tired."; bx = wx; who = "w"; } }
    else if (ph === "decide") say = "What should we do? Choose a decision on the right.";
    else if (ph === "brk") { if (el < 1.5) say = dec.say; else { say = dec.reply; bx = wx; who = "w"; } }
    else if (ph === "done") say = "Case closed and recorded. Back to the desk.";
    if (ph !== "idle" && !(ph === "notify" && esc_)) s += bubble(clamp(bx, 90, 700), by - (who === "w" ? 6 : 0), say, who);
    $("supSvg").innerHTML = s;
    var cap = ph === "idle" ? "Waiting for an alert. Press “Run shift to next alert”." :
      ph === "notify" ? "The tablet buzzes and the monitor turns red. Nothing happens until the supervisor acknowledges." :
      ph === "acked" ? "Acknowledged. The backend stored who and when." :
      ph === "walk" ? "The supervisor walks to the worker's station." :
      ph === "talk" ? "Check-in: look at the worker and ask how they feel." :
      ph === "decide" ? "Decide: " + DECISIONS.map(function (d) { return d.text; }).join(" / ") + "." :
      ph === "brk" ? "Decision applied: " + dec.text + ". The alert is closed in the backend." :
      "Done. The outcome is in the audit log and the CSV report.";
    if ($("supSay").textContent !== cap) $("supSay").textContent = cap;
  }
  requestAnimationFrame(frame);
  poll();
})();
