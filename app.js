/* ============================================================
   dosewell — client-side medication reminder.
   No network. No dependencies. All state in localStorage.
   ============================================================ */
(function () {
  "use strict";

  /* ---------- tiny helpers ---------- */
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* ---------- day-parts, in order ---------- */
  var PARTS = ["morning", "noon", "evening", "night"];
  var PART_LABEL = { morning: "Morning", noon: "Noon", evening: "Evening", night: "Night" };
  // inline glyph markup for each day-part (matches the ones in index.html)
  var PART_GLYPH = {
    morning: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="14" r="5"></circle><path d="M12 4v3M4.5 9l2 1.5M19.5 9l-2 1.5M3 20h18"></path></svg>',
    noon:    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5"></circle><path d="M12 1v3M12 20v3M1 12h3M20 12h3M4 4l2 2M18 18l2 2M20 4l-2 2M6 18l-2 2"></path></svg>',
    evening: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="15" r="4.5"></circle><path d="M12 6v2M5 11l1.5 1M19 11l-1.5 1M3 20h18M8 20l1-2M16 20l-1-2"></path></svg>',
    night:   '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 14.5A7.5 7.5 0 1 1 10 5a6 6 0 0 0 8 9.5z"></path><path d="M17 4l.7 1.6L19.3 6l-1.6.7L17 8.3l-.7-1.6L14.7 6l1.6-.7z" class="dayarc__star"></path></svg>'
  };
  var CAMERA_GLYPH =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h3l1.5-2h7L18 7h2a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z"></path><circle cx="12" cy="13" r="3.5"></circle></svg>';
  var CHECK_GLYPH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 13l4 4L19 7"></path></svg>';

  /* ============================================================
     STORAGE — meds[] and taken{date:{medId::part:true}}
     ============================================================ */
  var KEY_MEDS = "dosewell:meds:v1";
  var KEY_TAKEN = "dosewell:taken:v1";
  var storageOk = true;

  var meds = [];   // { id, name, note, photoDataUrl, parts:[...] }
  var taken = {};  // { "YYYY-MM-DD": { "id::part": true } }

  function loadState() {
    try {
      var m = localStorage.getItem(KEY_MEDS);
      meds = m ? (JSON.parse(m) || []) : [];
    } catch (e) { meds = []; }
    try {
      var t = localStorage.getItem(KEY_TAKEN);
      taken = t ? (JSON.parse(t) || {}) : {};
    } catch (e) { taken = {}; }
    if (!Array.isArray(meds)) meds = [];
    if (!taken || typeof taken !== "object") taken = {};
  }

  function saveMeds() {
    if (!storageOk) return;
    try { localStorage.setItem(KEY_MEDS, JSON.stringify(meds)); }
    catch (e) { storageOk = false; announce("Could not save — your browser storage may be full or blocked."); }
  }
  function saveTaken() {
    if (!storageOk) return;
    // keep taken data lean: prune anything older than ~14 days
    var cutoff = dateKey(new Date(Date.now() - 14 * 864e5));
    Object.keys(taken).forEach(function (k) { if (k < cutoff) delete taken[k]; });
    try { localStorage.setItem(KEY_TAKEN, JSON.stringify(taken)); }
    catch (e) { storageOk = false; }
  }

  function uid() {
    return "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /* ============================================================
     DATES + DAY-PART
     ============================================================ */
  function dateKey(d) {
    d = d || new Date();
    var y = d.getFullYear();
    var m = ("0" + (d.getMonth() + 1)).slice(-2);
    var day = ("0" + d.getDate()).slice(-2);
    return y + "-" + m + "-" + day;
  }

  // Which day-part is "now" — used to highlight the arc, not to gate anything.
  function currentPart(d) {
    var h = (d || new Date()).getHours();
    if (h >= 5 && h < 11) return "morning";
    if (h >= 11 && h < 16) return "noon";
    if (h >= 16 && h < 20) return "evening";
    return "night";
  }

  function todayKey() { return dateKey(new Date()); }

  function takenMap() {
    var k = todayKey();
    if (!taken[k]) taken[k] = {};
    return taken[k];
  }
  function isTaken(medId, part) { return !!takenMap()[medId + "::" + part]; }
  function setTaken(medId, part, val) {
    var map = takenMap();
    if (val) map[medId + "::" + part] = true;
    else delete map[medId + "::" + part];
    saveTaken();
  }

  /* ============================================================
     ANNOUNCE (screen-reader live region)
     ============================================================ */
  function announce(msg) {
    var live = $("#live");
    if (live) { live.textContent = ""; live.textContent = msg; }
  }

  /* ============================================================
     CLOCK + DAY ARC
     ============================================================ */
  function updateClock() {
    var now = new Date();
    var days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    var h = now.getHours(), m = now.getMinutes();
    var ampm = h >= 12 ? "PM" : "AM";
    var h12 = h % 12; if (h12 === 0) h12 = 12;
    $("#clockDay").textContent = days[now.getDay()];
    $("#clockTime").textContent = h12 + ":" + ("0" + m).slice(-2) + " " + ampm;

    // move the sun/moon along the arc by fraction of day
    var frac = (h * 60 + m) / (24 * 60);
    var dot = $("#dayarcNow");
    if (dot) {
      var cx = frac * 1200;
      // sample the arc path roughly: quadratic-ish dip then rise; use a soft curve
      var t = frac;
      var cy = 130 - Math.sin(t * Math.PI) * 95; // peak near midday
      dot.setAttribute("cx", cx.toFixed(1));
      dot.setAttribute("cy", cy.toFixed(1));
    }
    // highlight the active day-part
    var part = currentPart(now);
    $$(".dayarc__mark").forEach(function (mk) {
      mk.classList.toggle("is-now", mk.getAttribute("data-part") === part);
    });
  }

  /* ============================================================
     TODAY VIEW
     ============================================================ */
  function renderToday() {
    var host = $("#doses");
    var emptyEl = $("#todayEmpty");
    host.innerHTML = "";

    if (!meds.length) {
      emptyEl.hidden = false;
      $("#todayProgress").textContent = "Add a medicine to get started.";
      $("#speakBtn").disabled = true;
      return;
    }
    emptyEl.hidden = true;
    $("#speakBtn").disabled = false;

    var totalDue = 0, totalTaken = 0;
    var nowPart = currentPart(new Date());

    PARTS.forEach(function (part) {
      var due = meds.filter(function (med) { return med.parts.indexOf(part) !== -1; });
      if (!due.length) return;

      var group = el("section", "dosegroup");
      group.setAttribute("aria-labelledby", "grp-" + part);

      var head = el("div", "dosegroup__head");
      var glyph = el("span", "dosegroup__glyph");
      glyph.innerHTML = PART_GLYPH[part];
      head.appendChild(glyph);
      var title = el("h2", "dosegroup__title", PART_LABEL[part]);
      title.id = "grp-" + part;
      head.appendChild(title);
      var doneInPart = due.filter(function (med) { return isTaken(med.id, part); }).length;
      var count = el("span", "dosegroup__count", doneInPart + " / " + due.length + " taken");
      head.appendChild(count);
      group.appendChild(head);

      var list = el("ul", "dosegroup__list");
      // sort: not-taken first, taken sink to the bottom
      due.sort(function (a, b) {
        return (isTaken(a.id, part) ? 1 : 0) - (isTaken(b.id, part) ? 1 : 0);
      });

      due.forEach(function (med) {
        totalDue++;
        var done = isTaken(med.id, part);
        if (done) totalTaken++;

        var li = el("li", "dose" + (done ? " is-taken" : ""));

        // thumbnail
        if (med.photoDataUrl) {
          var img = el("img", "dose__thumb");
          img.src = med.photoDataUrl;
          img.alt = "Photo of " + med.name;
          li.appendChild(img);
        } else {
          var blank = el("span", "dose__thumb dose__thumb--blank");
          blank.setAttribute("aria-hidden", "true");
          blank.innerHTML = CAMERA_GLYPH;
          li.appendChild(blank);
        }

        var body = el("div", "dose__body");
        body.appendChild(el("p", "dose__name", med.name));
        if (med.note) body.appendChild(el("p", "dose__note", med.note));
        li.appendChild(body);

        var btn = el("button", "taken");
        btn.type = "button";
        var chk = el("span", "taken__check");
        chk.innerHTML = CHECK_GLYPH;
        btn.appendChild(chk);
        btn.appendChild(el("span", "taken__label", done ? "Taken" : "Taken?"));
        btn.setAttribute("aria-pressed", done ? "true" : "false");
        btn.setAttribute("aria-label",
          (done ? "Mark not taken: " : "Mark taken: ") + med.name + ", " + PART_LABEL[part]);
        btn.addEventListener("click", function () {
          var nowDone = !isTaken(med.id, part);
          setTaken(med.id, part, nowDone);
          announce(nowDone
            ? med.name + " marked as taken for " + PART_LABEL[part] + "."
            : med.name + " marked as not taken for " + PART_LABEL[part] + ".");
          renderToday();
        });
        li.appendChild(btn);

        list.appendChild(li);
      });

      group.appendChild(list);
      host.appendChild(group);
    });

    // progress line
    var prog = $("#todayProgress");
    if (totalDue === 0) {
      prog.textContent = "No doses scheduled. Add day-parts to your medicines.";
      prog.classList.remove("is-complete");
    } else if (totalTaken === totalDue) {
      prog.textContent = "All done — every dose is taken today. 🌿";
      prog.classList.add("is-complete");
    } else {
      prog.innerHTML = "";
      prog.appendChild(el("b", null, totalTaken + " of " + totalDue));
      prog.appendChild(document.createTextNode(" doses taken today."));
      prog.classList.remove("is-complete");
    }

    // gently mark the group matching the current time (no gating, just a hint)
    $$(".dosegroup").forEach(function (g) {
      var lbl = $(".dosegroup__title", g);
      g.classList.toggle("is-now", lbl && lbl.id === "grp-" + nowPart);
    });
  }

  /* ============================================================
     MANAGE VIEW
     ============================================================ */
  function renderManage() {
    var host = $("#medlist");
    var emptyEl = $("#manageEmpty");
    host.innerHTML = "";

    if (!meds.length) { emptyEl.hidden = false; return; }
    emptyEl.hidden = true;

    meds.forEach(function (med) {
      var li = el("li", "medcard");

      if (med.photoDataUrl) {
        var img = el("img", "medcard__thumb");
        img.src = med.photoDataUrl;
        img.alt = "Photo of " + med.name;
        li.appendChild(img);
      } else {
        var blank = el("span", "medcard__thumb medcard__thumb--blank");
        blank.setAttribute("aria-hidden", "true");
        blank.innerHTML = CAMERA_GLYPH;
        li.appendChild(blank);
      }

      var body = el("div", "medcard__body");
      body.appendChild(el("p", "medcard__name", med.name));
      if (med.note) body.appendChild(el("p", "medcard__note", med.note));
      var tags = el("div", "medcard__parts");
      PARTS.forEach(function (part) {
        if (med.parts.indexOf(part) === -1) return;
        var tag = el("span", "parttag");
        tag.innerHTML = PART_GLYPH[part];
        tag.appendChild(el("span", null, PART_LABEL[part]));
        tags.appendChild(tag);
      });
      body.appendChild(tags);
      li.appendChild(body);

      var actions = el("div", "medcard__actions");
      var edit = el("button", "btn btn--soft", "Edit");
      edit.type = "button";
      edit.setAttribute("aria-label", "Edit " + med.name);
      edit.addEventListener("click", function () { openSheet(med.id); });
      actions.appendChild(edit);

      var del = el("button", "btn btn--danger", "Delete");
      del.type = "button";
      del.setAttribute("aria-label", "Delete " + med.name);
      del.addEventListener("click", function () { deleteMed(med.id); });
      actions.appendChild(del);

      li.appendChild(actions);
      host.appendChild(li);
    });
  }

  function deleteMed(id) {
    var med = meds.filter(function (m) { return m.id === id; })[0];
    var name = med ? med.name : "this medicine";
    if (!window.confirm("Delete " + name + "? This cannot be undone.")) return;
    meds = meds.filter(function (m) { return m.id !== id; });
    saveMeds();
    announce(name + " deleted.");
    renderAll();
  }

  /* ============================================================
     ADD / EDIT SHEET
     ============================================================ */
  var editingId = null;
  var lastFocused = null;

  function openSheet(id) {
    editingId = id || null;
    lastFocused = document.activeElement;
    var sheet = $("#sheet");
    var title = $("#sheetTitle");
    var saveBtn = $("#saveBtn");

    // reset form
    $("#medform").reset();
    $$("input[name=part]").forEach(function (c) { c.checked = false; });
    hideError("#nameError"); hideError("#partsError");
    resetPhotoUI();
    pendingPhoto = null;

    if (editingId) {
      var med = meds.filter(function (m) { return m.id === editingId; })[0];
      if (med) {
        title.textContent = "Edit medicine";
        saveBtn.textContent = "Save changes";
        $("#medName").value = med.name;
        $("#medNote").value = med.note || "";
        med.parts.forEach(function (p) {
          var box = $('input[name=part][value="' + p + '"]');
          if (box) box.checked = true;
        });
        if (med.photoDataUrl) {
          pendingPhoto = med.photoDataUrl;
          showCapturedPhoto(med.photoDataUrl);
        }
      }
    } else {
      title.textContent = "Add a medicine";
      saveBtn.textContent = "Save medicine";
    }

    sheet.hidden = false;
    document.body.style.overflow = "hidden";
    setTimeout(function () { $("#medName").focus(); }, 30);
  }

  function closeSheet() {
    stopCamera();
    $("#sheet").hidden = true;
    document.body.style.overflow = "";
    editingId = null;
    pendingPhoto = null;
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }

  function showError(sel) { var e = $(sel); if (e) e.hidden = false; }
  function hideError(sel) { var e = $(sel); if (e) e.hidden = true; }

  function submitForm(ev) {
    ev.preventDefault();
    var name = $("#medName").value.trim();
    var note = $("#medNote").value.trim();
    var parts = $$("input[name=part]:checked").map(function (c) { return c.value; });
    // keep parts in canonical order
    parts = PARTS.filter(function (p) { return parts.indexOf(p) !== -1; });

    var ok = true;
    if (!name) { showError("#nameError"); ok = false; } else hideError("#nameError");
    if (!parts.length) { showError("#partsError"); ok = false; } else hideError("#partsError");
    if (!ok) { $("#medName").focus(); return; }

    if (editingId) {
      var med = meds.filter(function (m) { return m.id === editingId; })[0];
      if (med) {
        med.name = name; med.note = note; med.parts = parts;
        med.photoDataUrl = pendingPhoto || null;
      }
      announce(name + " updated.");
    } else {
      meds.push({ id: uid(), name: name, note: note, parts: parts, photoDataUrl: pendingPhoto || null });
      announce(name + " added.");
    }
    saveMeds();
    closeSheet();
    renderAll();
  }

  /* ============================================================
     PHOTO CAPTURE (getUserMedia -> canvas -> dataURL)
     ============================================================ */
  var stream = null;
  var pendingPhoto = null; // dataURL staged for save

  function photoMsg(text, warn) {
    var m = $("#photoMsg");
    m.textContent = text || "";
    m.hidden = !text;
    m.classList.toggle("is-warn", !!warn);
  }

  function resetPhotoUI() {
    stopCamera();
    $("#photoVideo").hidden = true;
    $("#photoCanvas").hidden = true;
    $("#photoPreview").hidden = true;
    $("#photoPreview").removeAttribute("src");
    $("#photoPlaceholder").hidden = false;
    $("#cameraBtn").hidden = false;
    $("#captureBtn").hidden = true;
    $("#retakeBtn").hidden = true;
    $("#clearPhotoBtn").hidden = true;
    photoMsg("", false);
  }

  function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      photoMsg("This device or browser has no camera we can use. You can still save without a photo.", true);
      return;
    }
    photoMsg("Starting the camera…", false);
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then(function (s) {
        stream = s;
        var v = $("#photoVideo");
        v.srcObject = s;           // assign the stream directly (never a URL) — CSP-safe
        v.play().catch(function () {});
        $("#photoPlaceholder").hidden = true;
        $("#photoPreview").hidden = true;
        v.hidden = false;
        $("#cameraBtn").hidden = true;
        $("#captureBtn").hidden = false;
        $("#retakeBtn").hidden = true;
        photoMsg("Point at the pill or box, then press Capture photo.", false);
      })
      .catch(function (err) {
        var msg = "We could not open the camera.";
        if (err && (err.name === "NotAllowedError" || err.name === "SecurityError")) {
          msg = "Camera permission was declined. You can allow it in your browser settings, or just save without a photo.";
        } else if (err && err.name === "NotFoundError") {
          msg = "No camera was found on this device. You can still save without a photo.";
        }
        photoMsg(msg, true);
        resetPhotoUI();
      });
  }

  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach(function (t) { t.stop(); });
      stream = null;
    }
    var v = $("#photoVideo");
    if (v) v.srcObject = null;
  }

  function capturePhoto() {
    var v = $("#photoVideo");
    var c = $("#photoCanvas");
    var w = v.videoWidth || 640;
    var h = v.videoHeight || 480;
    // cap the stored image so localStorage stays small
    var maxW = 640;
    if (w > maxW) { h = Math.round(h * (maxW / w)); w = maxW; }
    c.width = w; c.height = h;
    var ctx = c.getContext("2d");
    ctx.drawImage(v, 0, 0, w, h);
    var url;
    try { url = c.toDataURL("image/jpeg", 0.82); }
    catch (e) { photoMsg("Could not capture the photo. You can save without one.", true); return; }
    pendingPhoto = url;
    stopCamera();
    showCapturedPhoto(url);
    announce("Photo captured.");
  }

  function showCapturedPhoto(url) {
    var p = $("#photoPreview");
    p.src = url;
    p.hidden = false;
    $("#photoVideo").hidden = true;
    $("#photoPlaceholder").hidden = true;
    $("#cameraBtn").hidden = true;
    $("#captureBtn").hidden = true;
    $("#retakeBtn").hidden = false;
    $("#clearPhotoBtn").hidden = false;
    photoMsg("", false);
  }

  function clearPhoto() {
    pendingPhoto = null;
    resetPhotoUI();
    announce("Photo removed.");
  }

  /* ============================================================
     SPEECH — read due doses aloud (only while page is open)
     ============================================================ */
  function speakDue() {
    var btn = $("#speakBtn");
    if (!("speechSynthesis" in window)) {
      announce("Reading aloud is not available in this browser.");
      photoSafeAlert("Sorry — this browser can't read aloud.");
      return;
    }
    // toggle off if already speaking
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      btn.classList.remove("is-speaking");
      return;
    }

    var nowPart = currentPart(new Date());
    var due = [];
    meds.forEach(function (med) {
      if (med.parts.indexOf(nowPart) !== -1 && !isTaken(med.id, nowPart)) {
        due.push(med.name + (med.note ? ", " + med.note : ""));
      }
    });

    var text;
    if (!meds.length) {
      text = "You have no medicines added yet.";
    } else if (!due.length) {
      text = "Nothing is due right now for " + PART_LABEL[nowPart] + ". Well done.";
    } else {
      text = "For " + PART_LABEL[nowPart] + ", you still need to take: " + due.join("; ") + ".";
    }

    var u = new SpeechSynthesisUtterance(text);
    u.rate = 0.92; u.pitch = 1;
    u.onstart = function () { btn.classList.add("is-speaking"); };
    u.onend = function () { btn.classList.remove("is-speaking"); };
    u.onerror = function () { btn.classList.remove("is-speaking"); };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
    announce(text);
  }

  function photoSafeAlert(msg) { announce(msg); }

  /* ============================================================
     VIEW SWITCHING
     ============================================================ */
  function switchView(name) {
    var isToday = name === "today";
    $("#today").classList.toggle("is-active", isToday);
    $("#manage").classList.toggle("is-active", !isToday);
    $("#today").hidden = !isToday;
    $("#manage").hidden = isToday;

    $("#tabToday").classList.toggle("is-active", isToday);
    $("#tabManage").classList.toggle("is-active", !isToday);
    $("#tabToday").setAttribute("aria-selected", isToday ? "true" : "false");
    $("#tabManage").setAttribute("aria-selected", isToday ? "false" : "true");

    if (isToday) renderToday(); else renderManage();
  }

  /* ============================================================
     RENDER ALL
     ============================================================ */
  function renderAll() {
    renderToday();
    renderManage();
  }

  /* ============================================================
     DAY ROLLOVER — if the calendar day changes while open, refresh
     ============================================================ */
  var lastDay = todayKey();
  function checkDayRollover() {
    var k = todayKey();
    if (k !== lastDay) { lastDay = k; renderToday(); }
    updateClock();
  }

  /* ============================================================
     WIRE UP
     ============================================================ */
  function init() {
    // storage feature test
    try { localStorage.setItem("dosewell:test", "1"); localStorage.removeItem("dosewell:test"); }
    catch (e) { storageOk = false; }

    loadState();

    // tabs
    $("#tabToday").addEventListener("click", function () { switchView("today"); });
    $("#tabManage").addEventListener("click", function () { switchView("manage"); });

    // add buttons
    $("#addBtn").addEventListener("click", function () { openSheet(null); });
    $("#emptyAddBtn").addEventListener("click", function () { switchView("manage"); openSheet(null); });

    // speak
    $("#speakBtn").addEventListener("click", speakDue);

    // sheet controls
    $("#sheetClose").addEventListener("click", closeSheet);
    $("#cancelBtn").addEventListener("click", closeSheet);
    $("#sheetBackdrop").addEventListener("click", closeSheet);
    $("#medform").addEventListener("submit", submitForm);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !$("#sheet").hidden) closeSheet();
    });

    // photo
    $("#cameraBtn").addEventListener("click", startCamera);
    $("#captureBtn").addEventListener("click", capturePhoto);
    $("#retakeBtn").addEventListener("click", startCamera);
    $("#clearPhotoBtn").addEventListener("click", clearPhoto);

    // clear the parts error as soon as one is chosen
    $$("input[name=part]").forEach(function (c) {
      c.addEventListener("change", function () {
        if ($$("input[name=part]:checked").length) hideError("#partsError");
      });
    });
    $("#medName").addEventListener("input", function () {
      if ($("#medName").value.trim()) hideError("#nameError");
    });

    // clock + day-arc, refreshed each minute; also handles day rollover
    updateClock();
    setInterval(checkDayRollover, 30000);

    // if speech was mid-utterance when the page hides, stop it cleanly
    document.addEventListener("visibilitychange", function () {
      if (document.hidden && window.speechSynthesis) {
        window.speechSynthesis.cancel();
        var b = $("#speakBtn"); if (b) b.classList.remove("is-speaking");
      }
    });

    renderAll();
    switchView("today");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
