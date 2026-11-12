/* Lab screen: four things that need real equipment or people.
 *   1  Camera check + pilot session  (webcam in the browser, observer notes go to the pilot log in Results/System)
 *   2  Wristband over USB            (Web Serial; or a clearly marked simulated stream)
 *   3  Edge timing                   (shows bench result; load the JSON made on a Raspberry Pi)
 *   4  Hardware guide + firmware download
 * Nothing here marks a checklist item as done unless real evidence exists (a real wristband reading, a Pi result file).
 */
(function () {
  "use strict";
  var root = document.getElementById("labRoot");
  if (!root) return;
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var done = {};
  var STEPS = [["cam", "1 Camera started"], ["ses", "2 Session saved"], ["wb", "3 Wristband readings shown"], ["tim", "4 Timing measured"], ["fw", "5 Firmware downloaded"]];
  function mark(k) { done[k] = 1; $("lbSteps").innerHTML = STEPS.map(function (p) { return '<span class="pill ' + (done[p[0]] ? "normal" : "starting") + '">' + (done[p[0]] ? "✓ " : "") + p[1] + "</span>"; }).join(" "); }
  var tick = function (k) { if (window.FM_EXTRA) window.FM_EXTRA.setPlan(k, true); };

  /* bench result made in this project's sandbox. It is NOT a Raspberry Pi. */
  var BENCH = { device: "Intel Xeon @ 2.10 GHz (cloud test machine, not a Raspberry Pi)", pi: false, stages_ms: { "Landmarks to EAR/MAR (100 frames)": 2.03, "Eye-state CNN (100 frames)": 16.39, "Vision features": 0.03, "Vision XGBoost": 0.35, "Wearable features (PSD, 500 samples)": 0.42, "Wearable XGBoost": 0.31, "Fusion": 0.12 }, total_ms: 19.64 };

  root.innerHTML =
    '<div class="card" style="margin-bottom:14px"><h3>Demo steps <span class="small muted">each one turns green when you have done it</span></h3><div id="lbSteps" class="tools" style="margin:0"></div></div>' +
    '<div class="grid two">' +
    '<div class="card"><h3>1 · Camera check and pilot session</h3>' +
    '<p class="small muted" style="margin:0 0 8px">Checks that a webcam works and the lighting is good. It does not detect fatigue by itself: during a pilot the observer notes what really happened, and the note goes into the pilot log. The full camera pipeline runs on the edge device (<span class="mono">edge/record.py</span>).</p>' +
    '<video id="labVid" autoplay muted playsinline></video>' +
    '<div class="tools" style="margin:8px 0"><button class="btn2 pri" id="camOn" type="button">Start camera</button><button class="btn2" id="camOff" type="button" disabled>Stop</button><span class="small muted" id="camInfo">Camera off.</span></div>' +
    '<div class="req" style="grid-template-columns:repeat(2,minmax(0,1fr))"><input id="lbName" placeholder="Volunteer name or ID" aria-label="Volunteer"><select id="lbTired" aria-label="Observer note"><option value="0">Observer: looked alert</option><option value="1">Observer: looked tired</option></select></div>' +
    '<div class="tools" style="margin:8px 0 0"><button class="btn2 pri" id="lbStart" type="button">Start session timer</button><button class="btn2" id="lbSave" type="button" disabled>Stop and save to pilot log</button><span class="num" id="lbClock">00:00</span></div>' +
    '<p class="small" style="margin:6px 0 0" id="lbMsg"></p>' +
    '<div class="scroll"><table class="t"><thead><tr><th>Volunteer</th><th class="r">Min</th><th>Observer</th><th>Note</th></tr></thead><tbody id="lbLog"><tr><td colspan="4" class="muted">No sessions saved yet.</td></tr></tbody></table></div></div>' +

    '<div class="card"><h3>2 · Wristband over USB</h3>' +
    '<p class="small muted" style="margin:0 0 8px">Plug the ESP32 in and press Connect (Chrome or Edge on a laptop). It reads one line per second: heart rate, SpO2 and 50 motion values. The checklist item for the wristband is ticked only after 10 real readings.</p>' +
    '<div class="tools"><button class="btn2 pri" id="wbCon" type="button">Connect wristband</button><button class="btn2" id="wbBuzz" type="button" disabled>Send buzz</button><button class="btn2" id="wbSim" type="button">Simulated stream (no hardware)</button></div>' +
    '<div class="grid" style="grid-template-columns:repeat(3,minmax(0,1fr));margin:8px 0"><div class="kpi"><b id="wbHr">-</b><span>heart rate</span></div><div class="kpi"><b id="wbSp">-</b><span>SpO2 %</span></div><div class="kpi"><b id="wbMo">-</b><span>motion</span></div></div>' +
    '<canvas id="wbCv" width="480" height="70" style="width:100%;height:70px;display:block;margin:0 0 6px" aria-label="Heart rate (red) and motion (blue), last 60 seconds"></canvas>' +
    '<div class="lab-out" id="wbOut">Not connected. Press “Simulated stream” to see the chart without hardware.</div></div></div>' +

    '<div class="grid two" style="margin-top:14px">' +
    '<div class="card"><h3>3 · Edge timing</h3><p class="small muted" style="margin:0 0 8px">Time to make one decision (vision + wearable + fusion). The system needs one decision every 5 s. Run <span class="mono">python kit/bench_edge.py</span> on the Raspberry Pi and load the file it writes.</p>' +
    '<div class="scroll"><table class="t"><thead><tr><th>Stage</th><th class="r">ms</th></tr></thead><tbody id="bnT"></tbody></table></div>' +
    '<p class="small" id="bnS" style="margin:8px 0"></p>' +
    '<div class="tools"><button class="btn2 pri" id="bnRun" type="button">Measure on this computer</button><label class="btn2" for="bnFile" style="cursor:pointer">Load Pi result file</label><input type="file" id="bnFile" accept=".json" hidden></div></div>' +
    '<div class="card"><h3>4 · Hardware guide</h3><div class="scroll"><table class="t"><thead><tr><th>Part</th><th>Connects to</th><th>Why</th></tr></thead><tbody>' +
    '<tr><td>ESP32 board</td><td>USB laptop / Wi-Fi</td><td>runs the wristband program</td></tr>' +
    '<tr><td>MAX30102</td><td>ESP32 SDA 21, SCL 22, 3.3 V</td><td>heart rate, SpO2</td></tr>' +
    '<tr><td>MPU6050</td><td>same I2C pins</td><td>motion</td></tr>' +
    '<tr><td>Buzzer / motor</td><td>ESP32 pin 25</td><td>alert to worker</td></tr>' +
    '<tr><td>Raspberry Pi + camera</td><td>Wi-Fi to the dashboard</td><td>EAR / MAR / CNN</td></tr></tbody></table></div>' +
    '<div class="tools" style="margin-top:10px"><button class="btn2 pri" id="fwDl" type="button">Download wristband.ino</button></div>' +
    '<p class="small muted" style="margin:0">Open the file in Arduino IDE, choose “ESP32 Dev Module”, install the MAX30105 and MPU6050 libraries, upload, then use box 2. Pin numbers can differ per board, so check yours.</p></div></div>';

  /* ---------- 1 camera + pilot ---------- */
  var stream = null, lbT0 = null, lbTimer = null, vidCtx = document.createElement("canvas").getContext("2d");
  function camStop() { if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; $("labVid").srcObject = null; $("camOn").disabled = false; $("camOff").disabled = true; $("camInfo").textContent = "Camera off."; }
  $("camOn").onclick = function () {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { $("camInfo").textContent = "This browser has no camera access (open the page over https or from a file in Chrome)."; return; }
    navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } }).then(function (s) {
      stream = s; $("labVid").srcObject = s; $("camOn").disabled = true; $("camOff").disabled = false; $("camInfo").textContent = "Camera starting..."; mark("cam");
    }).catch(function (e) {
      var why = { NotAllowedError: "Permission blocked. Click the camera icon in the address bar, choose Allow, then press Start camera again.", NotFoundError: "No camera found. Plug in a webcam.", NotReadableError: "The camera is used by another app (Zoom, Teams). Close it and try again." }[e.name] || e.name;
      $("camInfo").textContent = "Camera not available. " + why;
    });
  };
  $("camOff").onclick = camStop;
  setInterval(function () {                      // brightness check, once a second
    var v = $("labVid"); if (!stream || !v.videoWidth) return;
    vidCtx.canvas.width = 64; vidCtx.canvas.height = 48; vidCtx.drawImage(v, 0, 0, 64, 48);
    var d = vidCtx.getImageData(0, 0, 64, 48).data, s = 0, n = d.length / 4;
    for (var i = 0; i < d.length; i += 4) s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    var b = s / n;
    $("camInfo").textContent = v.videoWidth + "×" + v.videoHeight + " · brightness " + Math.round(b) + "/255 · " + (b < 60 ? "too dark: add light" : b > 200 ? "too bright" : "lighting OK");
  }, 1000);
  var fm = function (s) { return ("0" + Math.floor(s / 60)).slice(-2) + ":" + ("0" + (s % 60)).slice(-2); };
  function paintLog() {
    var rows = document.querySelectorAll("#plBody tr"), h = "";
    Array.prototype.forEach.call(rows, function (r) { var c = r.children; if (c.length > 3) h += "<tr><td>" + esc(c[0].textContent) + '</td><td class="r num">' + esc(c[1].textContent) + "</td><td>" + (c[3].textContent === "Yes" ? "looked tired" : "looked alert") + "</td><td>" + esc(c[4].textContent) + "</td></tr>"; });
    $("lbLog").innerHTML = h || '<tr><td colspan="4" class="muted">No sessions saved yet.</td></tr>';
  }
  $("lbStart").onclick = function () {
    lbT0 = Date.now(); $("lbStart").disabled = true; $("lbSave").disabled = false; $("lbMsg").textContent = "Session running. Set the observer note while you watch, then press Stop and save.";
    lbTimer = setInterval(function () { $("lbClock").textContent = fm((Date.now() - lbT0) / 1000); }, 500);
  };
  $("lbSave").onclick = function () {
    var secs = (Date.now() - lbT0) / 1000, min = Math.max(1, Math.round(secs / 60));
    var code = $("lbName").value.trim() || "V" + (document.querySelectorAll("#plBody tr td.r").length + 1);
    clearInterval(lbTimer); $("lbStart").disabled = false; $("lbSave").disabled = true; $("lbClock").textContent = "00:00";
    var f = $("plForm");
    if (!(f && $("plId"))) { $("lbMsg").textContent = "Pilot log form not found."; return; }
    $("plId").value = code; $("plMin").value = min; $("plAl").value = 0; $("plTired").value = $("lbTired").value === "1" ? "Yes" : "No";
    if ($("plNote")) $("plNote").value = "Lab session " + Math.round(secs) + " s";
    f.requestSubmit ? f.requestSubmit() : f.dispatchEvent(new Event("submit", { cancelable: true }));
    $("lbName").value = ""; paintLog();
    mark("ses"); $("lbMsg").textContent = "Saved: " + code + ", " + Math.round(secs) + " s (counted as " + min + " min). It is in the list below and in the pilot log on the System screen.";
  };
  paintLog();

  /* ---------- 2 wristband ---------- */
  mark("none");
  var port = null, writer = null, reader = null, real = 0, sim = null;
  function show(o, src) {
    var m = 0; if (o.acc && o.acc.length) { var mean = o.acc.reduce(function (a, b) { return a + b; }, 0) / o.acc.length; m = Math.sqrt(o.acc.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / o.acc.length); }
    $("wbHr").textContent = o.hr != null ? Math.round(o.hr) : "-"; $("wbSp").textContent = o.spo2 != null ? Math.round(o.spo2) : "-"; $("wbMo").textContent = m.toFixed(2);
    mark("wb"); chart(o.hr, m); $("wbOut").textContent = src + "\n" + JSON.stringify({ hr: o.hr, spo2: o.spo2, acc: (o.acc || []).slice(0, 6).concat(["…"]) });
  }
  var hist = [];
  function chart(hr, mo) {
    hist.push([hr, mo]); if (hist.length > 60) hist.shift();
    var c = $("wbCv"), g = c.getContext("2d"), w = c.width, h = c.height; g.clearRect(0, 0, w, h);
    g.strokeStyle = "#9aa8c2"; g.globalAlpha = .4; g.strokeRect(0, 0, w, h); g.globalAlpha = 1;
    function ln(i, lo, hi, col) { g.beginPath(); g.strokeStyle = col; g.lineWidth = 2; hist.forEach(function (p, k) { var x = k * w / 59, y = h - 6 - ((p[i] - lo) / (hi - lo)) * (h - 12); k ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); }
    ln(0, 50, 130, "#ef4444"); ln(1, 0, 1.2, "#2563eb");
  }
  function line(txt) {
    var o; try { o = JSON.parse(txt); } catch (e) { return; }
    if (typeof o.hr !== "number") return;
    real++; show(o, "REAL reading " + real + " from the wristband");
    if (real >= 10) { tick("hw"); }
  }
  $("wbCon").onclick = function () {
    if (!("serial" in navigator)) { $("wbOut").textContent = "Web Serial needs Chrome or Edge on a laptop. Alternative: read the lines with edge/server.py."; return; }
    navigator.serial.requestPort().then(function (p) {
      port = p; return port.open({ baudRate: 115200 });
    }).then(function () {
      $("wbCon").disabled = true; $("wbBuzz").disabled = false; $("wbOut").textContent = "Connected. Waiting for the first line...";
      var dec = new TextDecoderStream(); port.readable.pipeTo(dec.writable); reader = dec.readable.getReader();
      var enc = new TextEncoderStream(); enc.readable.pipeTo(port.writable); writer = enc.writable.getWriter();
      var buf = "";
      (function pump() { reader.read().then(function (r) { if (r.done) return; buf += r.value; var p = buf.split("\n"); buf = p.pop(); p.forEach(line); pump(); }); })();
    }).catch(function (e) { $("wbOut").textContent = "Could not connect: " + e.message; });
  };
  $("wbBuzz").onclick = function () { if (writer) writer.write("BUZZ\n"); };
  $("wbSim").onclick = function () {
    if (sim) { clearInterval(sim); sim = null; $("wbSim").textContent = "Simulated stream (no hardware)"; return; }
    $("wbSim").textContent = "Stop simulated stream"; var k = 0;
    sim = setInterval(function () { k++; var acc = []; for (var i = 0; i < 50; i++) acc.push(+(Math.sin(k + i / 4) * 0.3 + Math.random() * 0.1).toFixed(2));
      show({ hr: 72 + 6 * Math.sin(k / 5) + Math.random() * 2, spo2: 97 + Math.round(Math.random()), acc: acc }, "SIMULATED (no hardware, does not tick the checklist)"); }, 1000);
  };

  /* ---------- 3 edge timing ---------- */
  function paintBench(b, label) {
    var st = b.stages_ms || {};
    $("bnT").innerHTML = Object.keys(st).map(function (k) { return "<tr><td>" + esc(k) + '</td><td class="r num">' + st[k] + "</td></tr>"; }).join("") + '<tr><td><b>Total</b></td><td class="r num"><b>' + b.total_ms + "</b></td></tr>";
    var m = 5000 / b.total_ms;
    $("bnS").innerHTML = "<b>" + esc(label) + ":</b> " + b.total_ms + " ms per decision, so a decision is ready " + Math.round(m) + "× faster than the 5 s needed. " + (m >= 1 ? "Fast enough." : "<b>Too slow: reduce frame rate.</b>");
  }
  paintBench(BENCH, BENCH.device);
  $("bnRun").onclick = function () {
    var E = window.FM_ENGINE && window.FM_ENGINE(); if (!E || !E.session) { $("bnS").textContent = "Data not loaded yet."; return; }
    $("bnRun").disabled = true; $("bnS").textContent = "Measuring...";
    setTimeout(function () {
      var eng = new E.Engine(E.models, E.session), n = 0, t0 = performance.now(), frames = 0;
      while (!eng.done() && frames < 1200) { var r = eng.frame(); frames++; if (r.win) n++; }
      var ms = performance.now() - t0, per = ms / Math.max(1, n);
      var st = { "Frames processed": frames, "Decisions made": n, "Total time (ms)": +ms.toFixed(1) };
      var b = { device: "THIS COMPUTER (" + (navigator.hardwareConcurrency || "?") + " cores, browser JavaScript port)", stages_ms: st, total_ms: +per.toFixed(2) };
      paintBench(b, b.device); $("bnS").innerHTML += " This is measured live in your browser, not on a Raspberry Pi."; mark("tim"); $("bnRun").disabled = false;
    }, 50);
  };
  $("bnFile").onchange = function (e) {
    var f = e.target.files[0]; if (!f) return;
    f.text().then(function (t) {
      var b = JSON.parse(t); if (!b.stages_ms || !b.total_ms) throw new Error("not a bench_result.json");
      var isPi = /raspberry|aarch64|arm/i.test((b.device || "") + (b.machine || ""));
      paintBench(b, b.device || "loaded file");
      if (isPi) { tick("pi"); $("bnS").innerHTML += " <b>Raspberry Pi result recognised: checklist item ticked.</b>"; }
      else $("bnS").innerHTML += " <b>This does not look like a Raspberry Pi, so the checklist is unchanged.</b>";
    }).catch(function (er) { $("bnS").textContent = "Could not read file: " + er.message; });
  };

  /* ---------- 4 firmware ---------- */
  $("fwDl").onclick = function () {
    var t = (window.FM_DATA && window.FM_DATA.firmware) || "// firmware not found";
    mark("fw"); var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([t], { type: "text/plain" })); a.download = "wristband.ino"; document.body.appendChild(a); a.click(); a.remove();
  };
})();
