/* Review-3 additions: real-data results, datasets, completion checklist, hardware parts, pilot log.
   Runs after app.js. Adds cards to the Results and System views. Everything typed or loaded here is kept in this browser's localStorage. */
(function () {
  "use strict";
  var $ = function (i) {
    return document.getElementById(i);
  };
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  };
  var mem = {};
  function load(k, d) {
    try {
      var v = localStorage.getItem("fm_" + k);
      return v ? JSON.parse(v) : mem[k] !== undefined ? mem[k] : d;
    } catch (e) {
      return mem[k] !== undefined ? mem[k] : d;
    }
  }
  function save(k, v) {
    mem[k] = v;
    try {
      localStorage.setItem("fm_" + k, JSON.stringify(v));
    } catch (e) {}
  }
  var pc = function (x) {
    return x == null ? "-" : (x * 100).toFixed(1) + "%";
  };

  var css = document.createElement("style");
  css.textContent =
    ".rd{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}@media(max-width:900px){.rd{grid-template-columns:minmax(0,1fr)}}" +
    ".rt{background:var(--sf2);border:1px solid var(--line);border-radius:8px;padding:12px;min-width:0}.rt h4{margin:0 0 2px;font-size:13px}" +
    ".rt .big{font-size:24px;font-weight:600;margin:4px 0}.rt.empty .big{color:var(--mute)}" +
    ".rt .kv{margin-top:6px}.fx{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px}" +
    ".cb{display:flex;gap:10px;align-items:flex-start;padding:7px 0;border-bottom:1px solid var(--line);font-size:13px}.cb:last-child{border:0}.cb input{margin-top:3px}" +
    ".pbar{height:10px;background:var(--line);border-radius:6px;overflow:hidden;margin:6px 0 4px}.pbar i{display:block;height:100%;background:var(--acc)}" +
    ".fm input,.fm select{background:var(--sf2);border:1px solid var(--line);border-radius:6px;padding:6px;min-width:0}.fm{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:6px;margin-bottom:8px}" +
    ".dtab td{white-space:normal!important;vertical-align:top}.dtab a{color:var(--acc)}";
  document.head.appendChild(css);

  /* ---------- real-data results ---------- */
  var KIND = {
    cnn: {
      file: "cnn_metrics.json",
      test: function (o) {
        return "heldout_subject_accuracy" in o;
      },
    },
    wear: {
      file: "wearable_metrics.json",
      test: function (o) {
        return "participants" in o && "auc" in o;
      },
    },
    yawn: {
      file: "yawdd_metrics.json",
      test: function (o) {
        return "best_threshold" in o;
      },
    },
  };
  var real = load("real", {});

  function tile(title, sub, big, kv, note, have) {
    return (
      '<div class="rt' +
      (have ? "" : " empty") +
      '"><h4>' +
      title +
      '</h4><div class="small muted">' +
      sub +
      '</div><div class="big num">' +
      big +
      "</div>" +
      (kv ? '<div class="kv small">' + kv + "</div>" : "") +
      '<p class="small muted" style="margin:8px 0 0">' +
      note +
      "</p></div>"
    );
  }
  var row = function (a, b) {
    return "<span>" + a + '</span><span class="num">' + esc(b) + "</span>";
  };

  function renderReal() {
    var c = real.cnn,
      w = real.wear,
      y = real.yawn;
    var t1 = c
      ? tile(
          "Eye-state CNN · MRL Eye",
          "People the network never saw",
          pc(c.heldout_subject_accuracy),
          row("Closed-eye recall", pc(c.closed_eye_recall)) +
            row("Images", c.images) +
            row("People", c.subjects) +
            row("Test images", c.test_images),
          "Simulated eyes gave 97.1%. Real eyes are harder, so a lower number is expected.",
          1,
        )
      : tile(
          "Eye-state CNN · MRL Eye",
          "People the network never saw",
          "not run yet",
          "",
          "Run kit/train_cnn_real.py, then paste its printed result here.",
          0,
        );
    var t2 = w
      ? tile(
          "Wearable model · Mohapatra",
          "Leave-participants-out test",
          pc(w.accuracy),
          row("Recall (tired found)", pc(w.recall)) +
            row("Precision", pc(w.precision)) +
            row("AUC", w.auc) +
            row("Guess-the-majority", pc(w.majority_baseline)) +
            row("Participants", w.participants) +
            row("Windows", w.windows) +
            row("Fatigued if rating ≥", w.threshold),
          "Real sensors: 2 Hz heart rate, HRV, temperature and movement. No SpO2. Self-rated fatigue labels. Compare accuracy with the guess-the-majority line.",
          1,
        )
      : tile(
          "Wearable model · Mohapatra",
          "Leave-participants-out test",
          "not run yet",
          "",
          "Run kit/train_wearable_mohapatra.py, then paste its printed result here.",
          0,
        );
    var t3 = y
      ? tile(
          "Yawn rule · YawDD",
          "Real driver videos",
          pc(y.accuracy),
          row("Videos", y.videos) +
            row("Yawning videos", y.yawn_videos) +
            row("Best MAR threshold", y.best_threshold),
          "Tests the mouth-opening (MAR) rule on real faces.",
          1,
        )
      : tile(
          "Yawn rule · YawDD",
          "Real driver videos",
          "not run yet",
          "",
          "Run kit/test_yawdd.py, then paste its printed result here.",
          0,
        );
    $("rdTiles").innerHTML = t1 + t2 + t3;
    var isSample = function (o) { return o && o.data_source === "sample"; };
    var ks = Object.keys(real), ns = ks.filter(function (k) { return isSample(real[k]); }).length, n = ks.length - ns;
    $("rdState").textContent = (n ? n + " of 3 real-data results loaded" : "No real-data results loaded yet") + (ns ? " · " + ns + " SAMPLE result" + (ns > 1 ? "s" : "") + " shown (not counted)" : "");
    var tl = $("rdTiles").children;
    Array.prototype.forEach.call(tl, function (el, i) {
      var o = real[["cnn", "wear", "yawn"][i]];
      if (isSample(o) && !el.querySelector(".sampleTag")) el.insertAdjacentHTML("afterbegin", '<div class="sampleTag" style="background:#fff3cd;color:#664d03;border:1px solid #e0b100;border-radius:6px;padding:3px 8px;font-size:12px;font-weight:600;margin-bottom:6px">SAMPLE DATA: made-up demo, not a real result</div>');
    });
    renderPlan();
  }

  /* Accepts the result in any easy form: a .json/.txt/.log file, or text pasted from the terminal.
     The training scripts print the result as {...}; Python prints it with single quotes, so we repair that. */
  function blocks(text) {
    var out = [], depth = 0, st = -1;
    for (var i = 0; i < text.length; i++) {
      if (text[i] === "{") { if (!depth) st = i; depth++; }
      else if (text[i] === "}" && depth) { depth--; if (!depth) out.push(text.slice(st, i + 1)); }
    }
    return out;
  }
  function toObj(b) {
    try { return JSON.parse(b); } catch (e) { /* Python style */ }
    try {
      return JSON.parse(b.replace(/'/g, '"').replace(/\bTrue\b/g, "true").replace(/\bFalse\b/g, "false").replace(/\bNone\b/g, "null").replace(/\bnan\b/gi, "null"));
    } catch (e2) { return null; }
  }
  function ingestText(text, name) {
    var n = 0;
    blocks(text).forEach(function (b) {
      var o = toObj(b), hit = false;
      if (!o) return;
      Object.keys(KIND).forEach(function (k) {
        if (!hit && KIND[k].test(o)) { real[k] = o; hit = true; n++; }
      });
    });
    if (!n) alert((name || "The text") + " does not contain a result from the three training scripts.");
    save("real", real);
    renderReal();
  }
  function ingest(files) {
    Array.prototype.forEach.call(files, function (f) {
      var r = new FileReader();
      r.onload = function () { ingestText(r.result, f.name); };
      r.readAsText(f);
    });
  }

  /* ---------- datasets ---------- */
  var DATA = [
    [
      "Simulated workers",
      "Made-up landmarks, eye images, heart rate, SpO2 and wrist motion for 48 workers (32 train, 16 test, 1,520 test windows)",
      "Every number in the first part of this page",
      "Used",
    ],
    [
      "MRL Eye",
      "About 85,000 infrared eye images labelled open or closed, with subject, glasses and lighting in the file name. Kaggle, 330 MB.",
      "Train and test the eye-state CNN on real eyes, split by person",
      "Ready to run",
      "https://www.kaggle.com/datasets/imadeddinedjerarda/mrl-eye-dataset",
    ],
    [
      "YawDD",
      "Videos of drivers yawning, talking and sitting normally (.avi). Kaggle, 5.1 GB, MIT licence.",
      "Test the yawn rule (MAR) on real faces",
      "Ready to run",
      "https://www.kaggle.com/datasets/enider/yawdd-dataset",
    ],
    [
      "Mohapatra et al. 2024",
      "Wearable chest sensor (heart rate, HRV, temperature, movement) plus 5 body motion sensors during a lifting task with added weights. Processed files every 0.5 s, fatigue rated by each person after each repetition. No SpO2.",
      "Train and test the wearable fatigue model on real people",
      "Ready to run",
      "https://zenodo.org/records/12788571",
    ],
  ];
  function renderData() {
    $("dsBody").innerHTML = DATA.map(function (d) {
      return (
        "<tr><td><b>" +
        d[0] +
        "</b>" +
        (d[4]
          ? '<br><a href="' +
            d[4] +
            '" target="_blank" rel="noopener">source</a>'
          : "") +
        "</td><td>" +
        d[1] +
        "</td><td>" +
        d[2] +
        '</td><td><span class="tag ' +
        (d[3] === "Used" ? "d" : "r") +
        '">' +
        d[3] +
        "</span></td></tr>"
      );
    }).join("");
  }

  /* ---------- completion checklist ---------- */
  var PLAN = [
    [
      "cnn",
      "Eye-state CNN trained and tested on real data (MRL Eye, YawDD)",
      "Auto-ticks when cnn_metrics.json is loaded",
    ],
    [
      "wear",
      "Wearable model trained and tested on real data (Mohapatra)",
      "Auto-ticks when wearable_metrics.json is loaded",
    ],
  ];
  var plan = load("plan", {});
  /* small hook so lab.js can tick an item once its real evidence exists */
  window.FM_EXTRA = { setPlan: function (k, v) { plan[k] = !!v; renderPlan(); } };
  function renderPlan() {
    var okReal = function (o) { return o && o.data_source !== "sample"; };
    if (okReal(real.cnn)) plan.cnn = true;
    if (okReal(real.wear)) plan.wear = true;
    save("plan", plan);
    var n = PLAN.filter(function (p) {
        return plan[p[0]];
      }).length,
      done = 7 + n,
      pct = Math.round((done / 9) * 100);
    $("cbList").innerHTML = PLAN.map(function (p) {
      return (
        '<label class="cb"><input type="checkbox" data-plan="' +
        p[0] +
        '"' +
        (plan[p[0]] ? " checked" : "") +
        "><span>" +
        p[1] +
        '<br><small class="muted">' +
        p[2] +
        "</small></span></label>"
      );
    }).join("") + '<p class="small muted" style="margin:8px 0 0"><b>Future work (outside this review):</b> Raspberry Pi timing, wristband and camera unit, volunteer pilot. The Lab screen and pilot log are ready for them.</p>';
    $("cbPct").innerHTML =
      '<b class="num" style="font-size:22px">' +
      pct +
      '%</b> <span class="muted">· ' +
      done +
      ' of 9 items done</span><div class="pbar"><i style="width:' +
      pct +
      '%"></i></div>';
    var rows =
      document.querySelectorAll(
        "#items .st",
      ); /* last five rows = the five open items */
    PLAN.forEach(function (q, i) {
      var r = rows[7 + i],
        t = r && r.querySelector(".tag");
      if (!t) return;
      var d = !!plan[q[0]];
      t.className = "tag " + (d ? "d" : "r");
      if (t.textContent !== (d ? "Done" : "Ready to run"))
        t.textContent = d ? "Done" : "Ready to run";
    });
    var p = $("pct"),
      tx = done + " of 9 done · " + pct + "%";
    if (p && p.textContent !== tx) p.textContent = tx;
  }

  /* ---------- hardware ---------- */
  var HW = [
    ["esp", "ESP32 board (wristband brain)"],
    ["hr", "MAX30102 sensor (heart rate and SpO2)"],
    ["imu", "MPU6050 sensor (motion)"],
    ["pow", "Battery and cables"],
    ["pi", "Raspberry Pi (edge device)"],
    ["cam", "Camera (Pi camera or USB webcam)"],
    ["buz", "Buzzer or vibration motor (worker alert)"],
  ];
  var hw = load("hw", {});
  var STATES = ["Need", "Ordered", "Have", "Working"];
  function renderHw() {
    $("hwList").innerHTML = HW.map(function (h) {
      var v = hw[h[0]] || "Need";
      return (
        '<div class="st"><span>' +
        h[1] +
        '</span><select data-hw="' +
        h[0] +
        '" aria-label="' +
        h[1] +
        '">' +
        STATES.map(function (s) {
          return (
            "<option" + (s === v ? " selected" : "") + ">" + s + "</option>"
          );
        }).join("") +
        "</select></div>"
      );
    }).join("");
    var w = HW.filter(function (h) {
      return hw[h[0]] === "Working";
    }).length;
    $("hwSum").textContent = w + " of " + HW.length + " parts working";
  }

  /* ---------- pilot ---------- */
  var pilot = load("pilot", []);
  function renderPilot() {
    var n = pilot.length,
      mins = 0,
      al = 0,
      ag = 0;
    pilot.forEach(function (p) {
      mins += +p.min || 0;
      al += +p.alerts || 0;
      if (
        (p.tired === "Yes" && +p.alerts > 0) ||
        (p.tired === "No" && +p.alerts === 0)
      )
        ag++;
    });
    $("plSum").innerHTML = n
      ? "<b>" +
        n +
        "</b> volunteers · <b>" +
        mins +
        "</b> minutes · <b>" +
        al +
        "</b> alerts · alert matched what the person reported in <b>" +
        ag +
        " of " +
        n +
        "</b> sessions"
      : "No sessions logged yet.";
    $("plBody").innerHTML = pilot
      .map(function (p, i) {
        return (
          "<tr><td>" +
          esc(p.id) +
          '</td><td class="r">' +
          esc(p.min) +
          '</td><td class="r">' +
          esc(p.alerts) +
          "</td><td>" +
          esc(p.tired) +
          "</td><td>" +
          esc(p.note) +
          '</td><td><button class="btn2" data-pdel="' +
          i +
          '" type="button">Remove</button></td></tr>'
        );
      })
      .join("");
  }

  /* ---------- build the DOM ---------- */
  function build() {
    var res = $("v-results"),
      sys = $("v-system");
    if (!res || !sys) return;
    var real_ = document.createElement("div");
    real_.innerHTML =
      '<div class="card" style="margin-bottom:14px"><h3>Real-data results (Review 3) <span class="small muted" id="rdState"></span></h3>' +
      '<div class="rd" id="rdTiles"></div>' +
      '<div class="fx"><label class="btn2 pri" style="cursor:pointer">Load result files<input type="file" id="rdFile" multiple hidden></label>' +
      '<button class="btn2" id="rdClear" type="button">Clear loaded results</button>' +
      '<span class="small muted">Easiest: paste the result printed in the terminal below. You can also pick any .json or .txt file. Everything stays in this browser.</span></div>' +
      '<textarea id="rdPaste" rows="3" placeholder="Paste here what the training script printed, e.g. {\'images\': 85000, \'heldout_subject_accuracy\': 0.93, ...}" style="width:100%;margin-top:8px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;background:var(--sf2);color:var(--ink);border:1px solid var(--line);border-radius:6px;padding:8px"></textarea>' +
      '<div class="fx"><button class="btn2 pri" id="rdPasteGo" type="button">Use pasted result</button></div></div>' +
      '<div class="card" style="margin-bottom:14px"><h3>Datasets</h3><div class="scroll"><table class="t dtab"><thead><tr><th>Dataset</th><th>What it is</th><th>What we use it for</th><th>Status</th></tr></thead><tbody id="dsBody"></tbody></table></div>' +
      '<p class="small muted" style="margin:8px 0 0">Real datasets are used for testing and training on real people. The simulated workers are what the live replay in this page uses, because we have no real sensors on real workers yet.</p></div>';
    var anchor = res.querySelector(".note.warn");
    if (anchor && anchor.parentNode)
      anchor.parentNode.insertBefore(real_, anchor.nextSibling);
    else res.appendChild(real_);

    var s = document.createElement("div");
    s.innerHTML =
      '<div class="grid two" style="margin-top:14px"><div class="card"><h3>Review 3 progress</h3><div id="cbPct"></div><div id="cbList"></div></div>' +
      '<div class="card"><h3>Hardware parts <span class="small muted" id="hwSum"></span></h3><div id="hwList"></div></div></div>' +
      '<div class="card" style="margin-top:14px"><h3>Pilot log</h3><p class="small muted" style="margin:0 0 8px">Use a code like V1, V2, not names. Each volunteer must sign the consent form first (pilot/consent_form.md).</p>' +
      '<form class="fm" id="plForm"><input id="plId" placeholder="Volunteer code" required><input id="plMin" type="number" min="1" placeholder="Minutes" required><input id="plAl" type="number" min="0" placeholder="Alerts raised" required>' +
      '<select id="plTired" aria-label="Did the person report feeling tired?"><option>No</option><option>Yes</option></select><input id="plNote" placeholder="Note (optional)"><button class="btn2 pri" type="submit">Add session</button></form>' +
      '<p class="small" id="plSum"></p><div class="scroll"><table class="t"><thead><tr><th>Volunteer</th><th class="r">Minutes</th><th class="r">Alerts</th><th>Reported tired</th><th>Note</th><th></th></tr></thead><tbody id="plBody"></tbody></table></div>' +
      '<div class="fx"><button class="btn2" id="plCsv" type="button">Download CSV</button></div></div>';
    sys.appendChild(s);

    $("rdFile").addEventListener("change", function (e) {
      ingest(e.target.files);
      e.target.value = "";
    });
    $("rdPasteGo").addEventListener("click", function () {
      ingestText($("rdPaste").value, "The pasted text");
      $("rdPaste").value = "";
    });
    $("rdClear").addEventListener("click", function () {
      real = {};
      save("real", real);
      plan.cnn = plan.wear = false;
      renderReal();
    });
    $("cbList").addEventListener("change", function (e) {
      var k = e.target.dataset.plan;
      if (k) {
        plan[k] = e.target.checked;
        save("plan", plan);
        renderPlan();
      }
    });
    $("hwList").addEventListener("change", function (e) {
      var k = e.target.dataset.hw;
      if (k) {
        hw[k] = e.target.value;
        save("hw", hw);
        renderHw();
      }
    });
    $("plForm").addEventListener("submit", function (e) {
      e.preventDefault();
      pilot.push({
        id: $("plId").value.trim(),
        min: $("plMin").value,
        alerts: $("plAl").value,
        tired: $("plTired").value,
        note: $("plNote").value.trim(),
      });
      save("pilot", pilot);
      e.target.reset();
      renderPilot();
    });
    $("plBody").addEventListener("click", function (e) {
      var i = e.target.dataset.pdel;
      if (i != null) {
        pilot.splice(+i, 1);
        save("pilot", pilot);
        renderPilot();
      }
    });
    $("plCsv").addEventListener("click", function () {
      var q = function (v) {
        return '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
      };
      var csv =
        "volunteer,minutes,alerts,reported_tired,note\n" +
        pilot
          .map(function (p) {
            return [p.id, p.min, p.alerts, p.tired, p.note].map(q).join(",");
          })
          .join("\n");
      var a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      a.download = "pilot_log.csv";
      a.click();
    });
    renderData();
    renderReal();
    renderHw();
    renderPilot();
    /* the original renderSystem() writes its own count into #pct; keep ours on top */
    var p = $("pct");
    if (p)
      new MutationObserver(function () {
        renderPlan();
      }).observe(p, { childList: true });
  }
  build();
})();
