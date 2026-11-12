/* Animated worker on the Live monitor screen.
 *
 * What moves, and what drives it (all numbers come from the running pipeline, nothing is scripted):
 *   eyes      open and close with the camera's eye-openness (EAR) frame by frame
 *   mouth     opens with the mouth ratio (MAR), a yawn is a wide open mouth
 *   head      droops and nods as the fused fatigue risk rises, and nods harder while the eyes stay shut
 *   arms      work the conveyor; the rhythm slows and gets uneven as risk rises
 *   heart     pulses at the worker's real (simulated) heart rate from the wristband
 *   helmet    lamp is green / amber / red with the worker's status, and blinks in alert
 *   wristband vibrates and rings when an alert is raised
 *   camera    cone turns grey when the face is hidden, and the lens is capped when the camera is covered
 *   edge box  shows the risk number that goes to the supervisor
 * app.js provides the numbers through window.FM_HOOK() (see the end of app.js).
 */
(function () {
  "use strict";
  var host = document.getElementById("sceneCard");
  if (!host || !window.FM_HOOK) return;

  var clamp = function (x, a, b) { return Math.max(a, Math.min(b, x)); };
  var lerp = function (a, b, k) { return a + (b - a) * k; };
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- markup ---------- */
  host.innerHTML =
    '<h3>Worker on the line <span class="small muted" id="scWho"></span></h3>' +
    '<div class="scene-grid">' +
    '<div class="scene-left"><div class="scene-box">' +
    '<svg id="scSvg" viewBox="0 0 760 340" role="img" aria-label="Animated worker at a conveyor with a camera and a wristband">' +
    // room
    '<rect x="0" y="0" width="760" height="300" fill="var(--sf2)"/>' +
    '<rect x="0" y="300" width="760" height="40" fill="var(--line)"/>' +
    '<rect x="0" y="298" width="760" height="5" fill="#f2c200"/>' +
    // wires: camera -> edge, wristband -> edge
    '<path id="scWireCam" d="M 656 96 V 24 H 120 V 44" fill="none" stroke="var(--mute)" stroke-width="2" stroke-dasharray="5 4"/>' +
    '<path id="scWireBand" d="M 322 224 C 220 224, 120 190, 120 100" fill="none" stroke="var(--mute)" stroke-width="2" stroke-dasharray="5 4"/>' +
    '<circle id="scDotCam" r="4" fill="#3b82f6"/><circle id="scDotBand" r="4" fill="#22c55e"/>' +
    // edge device
    '<g><rect x="50" y="44" width="140" height="56" rx="8" fill="var(--sf)" stroke="var(--acc)" stroke-width="2"/>' +
    '<text x="120" y="63" text-anchor="middle" font-size="12" font-weight="600" fill="var(--ink)">Edge device</text>' +
    '<text id="scEdge" x="120" y="86" text-anchor="middle" font-size="16" font-weight="600" fill="var(--acc)">risk -</text>' +
    '<circle id="scEdgeLed" cx="62" cy="56" r="4" fill="#22c55e"/></g>' +
    // camera on a pole
    '<line x1="700" y1="112" x2="700" y2="300" stroke="#6b7280" stroke-width="6"/>' +
    '<rect x="680" y="296" width="44" height="6" rx="3" fill="#6b7280"/>' +
    '<polygon id="scCone" points="660,102 412,64 412,132" fill="rgba(96,165,250,.20)"/>' +
    '<rect x="656" y="88" width="56" height="26" rx="5" fill="#1f2937"/>' +
    '<circle cx="656" cy="101" r="9" fill="#0b1220" stroke="#94a3b8" stroke-width="2"/>' +
    '<circle id="scCap" cx="656" cy="101" r="9" fill="#000" opacity="0"/>' +
    '<circle id="scRec" cx="704" cy="94" r="3.5" fill="#ef4444"/>' +
    '<text x="632" y="132" text-anchor="end" font-size="11" fill="var(--mute)">Camera</text>' +
    // worker (upper body rotates as one piece)
    '<g id="scBody">' +
    '<rect x="350" y="206" width="64" height="40" fill="#1e3a5f"/>' +                                   // hips
    '<rect x="346" y="128" width="72" height="92" rx="14" fill="#2f5d9e"/>' +                           // shirt
    '<path d="M346 134 Q382 160 418 134 L418 220 L346 220 Z" fill="#f28c28" opacity=".95"/>' +        // vest
    '<rect x="346" y="176" width="72" height="7" fill="#e5e7eb" opacity=".9"/>' +
    '<rect x="346" y="196" width="72" height="7" fill="#e5e7eb" opacity=".9"/>' +
    '<rect x="374" y="116" width="16" height="16" fill="#e0ac69"/>' +                                    // neck
    '<g id="scHead">' +
    '<circle cx="382" cy="98" r="24" fill="#f1c27d"/>' +
    '<circle cx="358" cy="100" r="5" fill="#e0ac69"/><circle cx="406" cy="100" r="5" fill="#e0ac69"/>' +
    '<ellipse id="scEyeL" cx="373" cy="99" rx="6.5" ry="5" fill="#fff" stroke="#6b4a2b" stroke-width="1"/>' +
    '<ellipse id="scEyeR" cx="391" cy="99" rx="6.5" ry="5" fill="#fff" stroke="#6b4a2b" stroke-width="1"/>' +
    '<circle id="scPupL" cx="373" cy="99.5" r="2.7" fill="#1b1b1b"/><circle id="scPupR" cx="391" cy="99.5" r="2.7" fill="#1b1b1b"/>' +
    '<path id="scLidL" d="M366 99 Q373 101 380 99" fill="none" stroke="#3b2a1a" stroke-width="2" stroke-linecap="round" opacity="0"/>' +
    '<path id="scLidR" d="M384 99 Q391 101 398 99" fill="none" stroke="#3b2a1a" stroke-width="2" stroke-linecap="round" opacity="0"/>' +
    '<path id="scBrowL" d="M365 89 L381 89" stroke="#3b2a1a" stroke-width="2.2" stroke-linecap="round"/>' +
    '<path id="scBrowR" d="M383 89 L399 89" stroke="#3b2a1a" stroke-width="2.2" stroke-linecap="round"/>' +
    '<ellipse id="scMouth" cx="382" cy="113" rx="5" ry="1.2" fill="#7a2e2e" stroke="#5a1f1f" stroke-width="1"/>' +
    '<path id="scSweat" d="M404 84 q3 5 0 8 q-3 -3 0 -8 z" fill="#60a5fa" opacity="0"/>' +
    '<rect id="scVisor" x="355" y="86" width="54" height="28" rx="8" fill="rgba(51,65,85,.88)" opacity="0"/>' +
    '<path d="M356 76 A26 24 0 0 1 408 76 L408 88 L356 88 Z" fill="#f5c400"/>' +                         // hard hat
    '<rect x="349" y="86" width="66" height="6" rx="3" fill="#d9a900"/>' +
    '<line x1="382" y1="52" x2="382" y2="88" stroke="#d9a900" stroke-width="2"/>' +
    '<circle id="scLamp" cx="382" cy="62" r="5.5" fill="#22c55e" stroke="#fff" stroke-width="1.5"/>' +
    '</g>' +
    // arms
    '<polyline id="scArmL" points="" fill="none" stroke="#2f5d9e" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<polyline id="scArmR" points="" fill="none" stroke="#2f5d9e" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<circle id="scHandL" r="7" fill="#f1c27d"/><circle id="scHandR" r="7" fill="#f1c27d"/>' +
    '<g id="scBand"><rect x="-9" y="-5" width="18" height="10" rx="3" fill="#111827"/><circle id="scBandLed" cx="0" cy="0" r="2.6" fill="#22c55e"/></g>' +
    '<circle id="scRing1" r="10" fill="none" stroke="#ef4444" stroke-width="2" opacity="0"/><circle id="scRing2" r="10" fill="none" stroke="#ef4444" stroke-width="2" opacity="0"/>' +
    '</g>' +
    // heart + readings on the wristband
    '<g id="scHeart"><path d="M0 4 C-10 -4 -6 -11 0 -6 C6 -11 10 -4 0 4 Z" fill="#ef4444"/></g>' +
    '<text id="scHr" x="0" y="0" font-size="13" font-weight="600" fill="var(--ink)">-</text>' +
    // conveyor in front of the worker
    '<rect x="150" y="232" width="470" height="20" rx="4" fill="#4b5563"/>' +
    '<rect x="150" y="252" width="470" height="48" fill="#374151"/>' +
    '<g id="scBoxes"></g>' +
    '<rect x="150" y="232" width="470" height="3" fill="#6b7280"/>' +
    // alert badge, Zzz
    '<g id="scBadge" opacity="0"><path d="M382 8 L404 46 L360 46 Z" fill="#ef4444" stroke="#fff" stroke-width="2"/><text x="382" y="40" text-anchor="middle" font-size="22" font-weight="700" fill="#fff">!</text></g>' +
    '<g id="scZ" opacity="0"><text x="420" y="64" font-size="20" font-weight="700" fill="var(--acc)">Z</text><text x="436" y="48" font-size="16" font-weight="700" fill="var(--acc)">z</text><text x="448" y="34" font-size="12" font-weight="700" fill="var(--acc)">z</text></g>' +
    '<text x="380" y="322" text-anchor="middle" font-size="11" fill="var(--mute)">Conveyor workstation</text>' +
    '</svg></div>' +
    '<div class="note" id="scSay">Press Play to start the shift.</div>' +
    '<div class="sup" id="scSup"><b>Supervisor tablet</b><div id="scSupMsg" class="small muted">No alert for this worker.</div>' +
    '<button class="btn2" data-nav="alerts" type="button" style="margin-top:6px">Open alert queue</button></div>' +
    '</div>' +
    // right-hand panel
    '<div class="scene-side">' +
    '<div class="tools" style="margin-bottom:8px"><select id="scSel" aria-label="Choose worker"></select>' +
    '<button class="btn2" id="scJump" type="button">Next worker in alert</button><button class="btn2" id="scCover" type="button">Cover camera</button></div>' +
    '<div class="row"><b id="scName"></b><span class="pill normal" id="scState">Normal</span></div>' +
    '<div class="small muted" id="scRole"></div>' +
    '<div class="meter big" style="margin:10px 0 2px;position:relative"><i id="scMeter" style="width:0"></i><u style="left:45%"></u><u style="left:55%"></u></div>' +
    '<div class="small muted" style="display:flex;justify-content:space-between"><span>0%</span><span>clear 45%</span><span>alert 55%</span><span>100%</span></div>' +
    '<div class="kv" style="margin:10px 0"><span>Fatigue risk</span><span class="num" id="vRisk">-</span><span>Eye openness (EAR)</span><span class="num" id="vEar">-</span>' +
    '<span>Mouth ratio (MAR)</span><span class="num" id="vMar">-</span><span>Heart rate</span><span class="num" id="vHr">-</span>' +
    '<span>Blood oxygen</span><span class="num" id="vSpo">-</span><span>Camera</span><span class="num" id="vCam">-</span></div>' +
    '</div></div>';

  /* ---------- handles ---------- */
  var g = function (id) { return document.getElementById(id); };
  var el = {};
  ["scBody", "scHead", "scEyeL", "scEyeR", "scPupL", "scPupR", "scLidL", "scLidR", "scBrowL", "scBrowR", "scMouth", "scSweat", "scVisor", "scLamp",
    "scArmL", "scArmR", "scHandL", "scHandR", "scBand", "scBandLed", "scRing1", "scRing2", "scHeart", "scHr", "scBoxes", "scBadge", "scZ", "scCone",
    "scCap", "scRec", "scEdge", "scEdgeLed", "scDotCam", "scDotBand", "scWireCam", "scWireBand"].forEach(function (id) { el[id] = g(id); });

  // boxes on the conveyor
  var boxes = [];
  for (var b = 0; b < 7; b++) {
    var r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    r.setAttribute("width", 40); r.setAttribute("height", 22); r.setAttribute("rx", 3);
    r.setAttribute("fill", b % 2 ? "#c9a36b" : "#b98f52"); r.setAttribute("stroke", "#8a6a3b");
    el.scBoxes.appendChild(r); boxes.push(r);
  }

  /* ---------- animation state ---------- */
  var S = { phase: 0, beat: 0, belt: 0, open: 1, mouth: 0, lean: 0, nod: 0, closedFor: 0, t: 0, ring: 0, lastTxt: "", acc: 0 };
  var last = performance.now();
  var camLen = el.scWireCam.getTotalLength(), bandLen = el.scWireBand.getTotalLength();

  function colorFor(st) { return st === "alert" ? "#ef4444" : st === "watch" ? "#f59e0b" : "#22c55e"; }

  function frame(now) {
    requestAnimationFrame(frame);
    var dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (!host.offsetParent) return;                         // Live screen is not showing
    var h = window.FM_HOOK(); if (!h) return;
    var run = h.playing && !h.ended, sp = run ? h.speed : 0;
    var risk = h.risk == null ? 0 : h.risk;
    var st = h.alert ? "alert" : risk >= 0.45 ? "watch" : "normal";
    S.t += dt;

    // targets from the real signals
    var ear = h.ear == null ? 0.3 : h.ear;
    var tOpen = h.vis === false && h.ear == null ? 1 : clamp((ear - 0.09) / 0.17, 0, 1);
    S.open = lerp(S.open, tOpen, 0.55);
    var tMouth = clamp(((h.mar == null ? 0.08 : h.mar) - 0.08) / 0.6, 0, 1);
    S.mouth = lerp(S.mouth, tMouth, 0.3);
    if (S.open < 0.35) S.closedFor += dt * (run ? h.speed : 0); else S.closedFor = 0;

    S.lean = lerp(S.lean, risk * 7, 0.05);
    var droop = risk * 14 + (S.closedFor > 0.6 ? 10 + 5 * Math.sin(S.t * 3) : 0) + (S.mouth > 0.5 ? -6 : 0);
    S.nod = lerp(S.nod, droop, 0.08);
    el.scBody.setAttribute("transform", "rotate(" + (S.lean).toFixed(2) + " 382 246)");
    el.scHead.setAttribute("transform", "rotate(" + (S.nod * 0.6).toFixed(2) + " 382 124) translate(0 " + (risk * 3).toFixed(2) + ")");

    // eyes
    var ry = 0.5 + 5 * S.open;
    ["L", "R"].forEach(function (s) {
      el["scEye" + s].setAttribute("ry", ry.toFixed(2));
      el["scPup" + s].setAttribute("opacity", S.open > 0.3 ? 1 : 0);
      el["scLid" + s].setAttribute("opacity", S.open <= 0.3 ? 1 : 0);
    });
    var sad = risk * 3;                                      // brows sink with tiredness
    el.scBrowL.setAttribute("d", "M365 " + (88 + sad * 0.2).toFixed(1) + " L381 " + (88 + sad).toFixed(1));
    el.scBrowR.setAttribute("d", "M383 " + (88 + sad).toFixed(1) + " L399 " + (88 + sad * 0.2).toFixed(1));
    // mouth
    el.scMouth.setAttribute("rx", (5 + 4 * S.mouth).toFixed(2));
    el.scMouth.setAttribute("ry", (1.2 + 8 * S.mouth).toFixed(2));
    el.scSweat.setAttribute("opacity", risk > 0.6 ? 0.9 : 0);
    el.scVisor.setAttribute("opacity", h.vis === false ? 1 : 0);

    // work cycle: slower and uneven as risk rises
    var cad = 1.45 * (1 - 0.5 * risk);
    var jitter = risk * 0.5 * Math.sin(S.t * 1.7) * Math.sin(S.t * 0.6);
    if (run) S.phase += dt * h.speed * cad * (1 + jitter) * 0.6 * 2 * Math.PI / 1;
    S.belt += run ? dt * h.speed * 26 * (1 - 0.35 * risk) : 0;
    var p = S.phase, amp = 16 * (1 - 0.45 * risk);
    var sh = [[352, 146], [412, 146]], hand = [];
    for (var i = 0; i < 2; i++) {
      var q = p + i * Math.PI, side = i ? 1 : -1;
      var hx = 382 + side * (52 + 4 * Math.sin(q)), hy = 222 - 2 + amp * Math.sin(q);
      var ex = 382 + side * 66, ey = (sh[i][1] + hy) / 2 + 6;
      hand.push([hx, hy]);
      el[i ? "scArmR" : "scArmL"].setAttribute("points", sh[i][0] + "," + sh[i][1] + " " + ex.toFixed(1) + "," + ey.toFixed(1) + " " + hx.toFixed(1) + "," + hy.toFixed(1));
      el[i ? "scHandR" : "scHandL"].setAttribute("cx", hx.toFixed(1)); el[i ? "scHandR" : "scHandL"].setAttribute("cy", hy.toFixed(1));
    }
    // boxes
    for (var k = 0; k < boxes.length; k++) {
      var x = 150 + ((S.belt + k * 74) % 518) - 48;
      boxes[k].setAttribute("x", x.toFixed(1)); boxes[k].setAttribute("y", 211);
    }

    // wristband + heart
    var bx = hand[0][0] + 0, by = hand[0][1] - 8;
    var shake = st === "alert" ? Math.sin(S.t * 60) * 1.6 : 0;
    el.scBand.setAttribute("transform", "translate(" + (bx + shake).toFixed(1) + " " + by.toFixed(1) + ")");
    el.scBandLed.setAttribute("fill", colorFor(st));
    S.beat += dt * (h.hr || 70) / 60;
    var pulse = 1 + 0.35 * Math.max(0, Math.sin(S.beat * 2 * Math.PI)) ** 3;
    el.scHeart.setAttribute("transform", "translate(" + (bx - 4).toFixed(1) + " " + (by - 22).toFixed(1) + ") scale(" + pulse.toFixed(2) + ")");
    el.scHr.setAttribute("x", (bx + 10).toFixed(1)); el.scHr.setAttribute("y", (by - 17).toFixed(1));
    el.scHr.textContent = h.hr ? Math.round(h.hr) : "-";
    S.ring = st === "alert" ? (S.ring + dt * 1.6) % 1 : 0;
    ["scRing1", "scRing2"].forEach(function (id, n) {
      var f = (S.ring + n * 0.5) % 1;
      el[id].setAttribute("cx", bx.toFixed(1)); el[id].setAttribute("cy", by.toFixed(1));
      el[id].setAttribute("r", (8 + 26 * f).toFixed(1)); el[id].setAttribute("opacity", st === "alert" ? (1 - f).toFixed(2) : 0);
    });

    // lamp, badge, zzz
    var blink = st !== "alert" || Math.sin(S.t * 9) > 0;
    el.scLamp.setAttribute("fill", blink ? colorFor(st) : "#7f1d1d");
    el.scBadge.setAttribute("opacity", st === "alert" && Math.sin(S.t * 6) > -0.3 ? 1 : 0);
    el.scZ.setAttribute("opacity", S.closedFor > 0.8 ? 1 : 0);

    // camera + data flow
    var seeing = h.vis !== false && !h.blocked;
    el.scCone.setAttribute("fill", h.blocked ? "rgba(0,0,0,0)" : seeing ? "rgba(96,165,250,.20)" : "rgba(148,163,184,.18)");
    el.scCone.setAttribute("stroke", seeing || h.blocked ? "none" : "#94a3b8"); el.scCone.setAttribute("stroke-dasharray", "5 4");
    el.scCap.setAttribute("opacity", h.blocked ? 1 : 0);
    el.scRec.setAttribute("opacity", !h.blocked && Math.sin(S.t * 4) > 0 ? 1 : 0.2);
    var d1 = el.scWireCam.getPointAtLength(((S.t * 0.35) % 1) * camLen), d2 = el.scWireBand.getPointAtLength(((S.t * 0.45) % 1) * bandLen);
    el.scDotCam.setAttribute("cx", d1.x); el.scDotCam.setAttribute("cy", d1.y); el.scDotCam.setAttribute("opacity", seeing && run ? 1 : 0.15);
    el.scDotBand.setAttribute("cx", d2.x); el.scDotBand.setAttribute("cy", d2.y); el.scDotBand.setAttribute("opacity", run ? 1 : 0.15);
    el.scEdge.textContent = h.risk == null ? "risk -" : "risk " + Math.round(risk * 100) + "%";
    el.scEdgeLed.setAttribute("fill", colorFor(st));

    // panel (text updates only when something changed)
    var key = [h.idx, st, Math.round(risk * 100), Math.round(ear * 100), Math.round((h.mar || 0) * 100), Math.round(h.hr || 0), h.vis, h.blocked, Math.floor(S.closedFor), h.playing].join("|");
    if (key !== S.lastTxt) {
      S.lastTxt = key;
      $("scWho").textContent = h.id + " · " + h.name;
      $("scName").textContent = h.name; $("scRole").textContent = h.role + " · " + h.station;
      var pill = $("scState"); pill.className = "pill " + st; pill.textContent = st === "alert" ? "Alert" : st === "watch" ? "Watch" : "Normal";
      $("scMeter").style.width = Math.round(risk * 100) + "%"; $("scMeter").style.background = colorFor(st);
      $("vRisk").textContent = h.risk == null ? "-" : Math.round(risk * 100) + "%";
      $("vEar").textContent = h.ear == null ? "-" : h.ear.toFixed(2) + (h.ear < 0.2 ? " (closed)" : "");
      $("vMar").textContent = h.mar == null ? "-" : h.mar.toFixed(2) + (h.mar > 0.45 ? " (yawn)" : "");
      $("vHr").textContent = h.hr ? Math.round(h.hr) + " bpm" : "-";
      $("vSpo").textContent = h.spo ? h.spo.toFixed(1) + " %" : "-";
      $("vCam").textContent = h.blocked ? "Covered" : h.vis === false ? "Face hidden" : "Sees face";
      $("scCover").textContent = h.blocked ? "Uncover camera" : "Cover camera";
      var say;
      if (h.t < 1) say = "Press Play. The worker starts fresh and alert.";
      else if (st === "alert") say = "ALERT. Fatigue risk " + Math.round(risk * 100) + "%. The wristband vibrates, the helmet lamp flashes red and the supervisor is told. Suggested action: a rest break.";
      else if (h.blocked) say = "The camera is covered. The system cannot see the eyes, so the wristband (heart rate, oxygen, movement rhythm) carries the decision.";
      else if (h.vis === false) say = "The face is hidden (helmet or visor). The camera cannot judge, so the decision falls back to the wristband.";
      else if (S.closedFor > 0.8) say = "Eyes have stayed closed for " + S.closedFor.toFixed(1) + " s. This is a micro-sleep sign.";
      else if ((h.mar || 0) > 0.45) say = "Yawning detected (mouth ratio " + h.mar.toFixed(2) + ").";
      else if (st === "watch") say = "Watch. Signs of tiredness are building. One more high reading in a row will raise an alert.";
      else say = "Working normally. Eyes open, steady rhythm, heart rate " + Math.round(h.hr || 0) + " bpm.";
      $("scSay").textContent = say; $("scSay").className = "note" + (st === "alert" ? " warn" : "");
      $("scSupMsg").textContent = st === "alert"
        ? '"' + h.name + " (" + h.station + ") shows fatigue signs, risk " + Math.round(risk * 100) + '%. Please give a rest break."'
        : "No alert for this worker.";
    }
  }

  /* ---------- controls ---------- */
  var sel = $("scSel");
  function fillSelect() {
    var list = window.FM_HOOK.list();
    if (!list.length) return false;
    sel.innerHTML = list.map(function (w, i) { return '<option value="' + i + '">' + w.id + " · " + w.name + "</option>"; }).join("");
    return true;
  }
  var poll = setInterval(function () { if (fillSelect()) { clearInterval(poll); sel.value = window.FM_HOOK().idx; } }, 300);
  sel.addEventListener("change", function () { window.FM_HOOK.setWorker(+sel.value); });
  $("scJump").addEventListener("click", function () { var i = window.FM_HOOK.nextAlert(); if (i >= 0) { window.FM_HOOK.setWorker(i); sel.value = i; } });
  $("scCover").addEventListener("click", function () { $("lcover").click(); });
  document.addEventListener("click", function (e) { if (e.target.closest && e.target.closest("[data-nav=live]")) setTimeout(function () { var h = window.FM_HOOK(); if (h) sel.value = h.idx; }, 0); });
  $("lw").addEventListener("change", function (e) { sel.value = e.target.value; });
  requestAnimationFrame(frame);
})();
