/* Achille HACCP — logique (100% local, aucune donnée envoyée) */
(function () {
  "use strict";
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));

  /* ---------- Stockage ---------- */
  const KEYS = { temp: "achille_haccp_temp_v1", liv: "achille_haccp_liv_v1", scan: "achille_haccp_scan_v1" };
  const state = { temp: load("temp"), liv: load("liv"), scan: load("scan") };
  function load(m) { try { return JSON.parse(localStorage.getItem(KEYS[m])) || []; } catch (e) { return []; } }
  function save(m) { try { localStorage.setItem(KEYS[m], JSON.stringify(state[m])); } catch (e) { toast("Stockage indisponible"); } }
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  /* ---------- Dates ---------- */
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function nowInput() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; }
  function fmtDT(ts) { const d = new Date(ts); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; }
  function fmtDate(s) { if (!s) return "—"; const d = new Date(s); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`; }

  /* ---------- Toast ---------- */
  let toastT;
  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2200); }

  /* ---------- Navigation ---------- */
  function go(name) {
    $$(".page").forEach(p => (p.hidden = p.dataset.page !== name));
    $$(".tab").forEach(t => t.classList.toggle("is-active", t.dataset.go === name));
    $("#view").scrollTop = 0;
    if (name !== "scan") stopScan();
  }
  document.addEventListener("click", e => {
    const nav = e.target.closest("[data-go]");
    if (nav) { go(nav.dataset.go); }
  });

  /* ---------- Appbar date ---------- */
  (function () {
    const d = new Date();
    $("#appDate").textContent = d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  })();

  /* ---------- Descripteurs d'export ---------- */
  const EX = {
    temp: {
      file: "temperatures", title: "Relevés de température",
      head: ["Date", "Zone / équipement", "Temp.", "Seuil", "Conformité", "Note"],
      confCol: 4,
      row: r => [fmtDT(r.ts), r.zone, r.temp + " °C", (r.seuil === "" || r.seuil == null ? "—" : r.seuil + " °C"), confLabel(r.conf), r.note || ""],
      data: () => state.temp
    },
    liv: {
      file: "livraisons", title: "Livraisons contrôlées",
      head: ["Date", "Fournisseur", "Produit", "Temp.", "DLC/DDM", "Conformité", "Note"],
      confCol: 5,
      row: r => [fmtDT(r.ts), r.fourn, r.prod, (r.temp === "" || r.temp == null ? "—" : r.temp + " °C"), fmtDate(r.dlc), confLabel(r.conf), r.note || ""],
      data: () => state.liv
    },
    scan: {
      file: "codes-barres", title: "Codes-barres enregistrés",
      head: ["Date", "Code", "Format", "Libellé"],
      confCol: -1,
      row: r => [fmtDT(r.ts), r.code, r.format || "—", r.label || ""],
      data: () => state.scan
    }
  };
  function confLabel(c) { return c == null ? "—" : c ? "Conforme" : "Non conforme"; }
  function confTag(c) { return c == null ? '<span class="tag">—</span>' : c ? '<span class="tag ok">✓ Conforme</span>' : '<span class="tag bad">✕ Non conf.</span>'; }
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* ---------- Rendu des tableaux ---------- */
  function render(m) {
    const wrap = { temp: "#tblTemp", liv: "#tblLiv", scan: "#tblScan" }[m];
    const countEl = { temp: "#tCount", liv: "#lCount", scan: "#sCount" }[m];
    const rows = state[m].slice().sort((a, b) => b.ts - a.ts);
    $(countEl).textContent = rows.length;
    if (!rows.length) { $(wrap).innerHTML = '<p class="empty">Aucune donnée pour le moment.</p>'; refreshHome(); return; }
    let cells;
    if (m === "temp") cells = r => `<td>${esc(fmtDT(r.ts))}</td><td>${esc(r.zone)}</td><td><b>${esc(r.temp)} °C</b></td><td>${r.seuil === "" || r.seuil == null ? "—" : esc(r.seuil) + " °C"}</td><td>${confTag(r.conf)}</td><td>${esc(r.note || "")}</td>`;
    else if (m === "liv") cells = r => `<td>${esc(fmtDT(r.ts))}</td><td>${esc(r.fourn)}</td><td>${esc(r.prod)}</td><td>${r.temp === "" || r.temp == null ? "—" : esc(r.temp) + " °C"}</td><td>${esc(fmtDate(r.dlc))}</td><td>${confTag(r.conf)}</td><td>${esc(r.note || "")}</td>`;
    else cells = r => `<td>${esc(fmtDT(r.ts))}</td><td><b>${esc(r.code)}</b></td><td>${esc(r.format || "—")}</td><td>${esc(r.label || "")}</td>`;
    const head = EX[m].head.map(h => `<th>${h}</th>`).join("") + "<th></th>";
    const body = rows.map(r => `<tr>${cells(r)}<td><button class="delrow" data-del="${m}" data-id="${r.id}" aria-label="Supprimer">✕</button></td></tr>`).join("");
    $(wrap).innerHTML = `<table class="data"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    refreshHome();
  }
  function refreshHome() {
    $("#cntTemp").textContent = state.temp.length + " relevé" + (state.temp.length > 1 ? "s" : "");
    $("#cntLiv").textContent = state.liv.length + " contrôle" + (state.liv.length > 1 ? "s" : "");
    $("#cntScan").textContent = state.scan.length + " code" + (state.scan.length > 1 ? "s" : "");
  }

  /* delete / clear */
  document.addEventListener("click", e => {
    const del = e.target.closest("[data-del]");
    if (del) { const m = del.dataset.del; state[m] = state[m].filter(r => r.id !== del.dataset.id); save(m); render(m); toast("Supprimé"); return; }
    const clr = e.target.closest("[data-clear]");
    if (clr) { const m = clr.dataset.clear; if (state[m].length && confirm("Vider toutes les données de ce tableau ?")) { state[m] = []; save(m); render(m); toast("Tableau vidé"); } }
  });

  /* ---------- Températures ---------- */
  $("#tDate").value = nowInput();
  $("#tType").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    $$("#tType button").forEach(x => x.classList.toggle("is-active", x === b));
    if (b.dataset.th !== "") $("#tSeuil").value = b.dataset.th;
    tempBadge();
  });
  $("#tTemp").addEventListener("input", tempBadge);
  $("#tSeuil").addEventListener("input", tempBadge);
  function tempBadge() {
    const t = parseFloat($("#tTemp").value), s = parseFloat($("#tSeuil").value);
    const el = $("#tBadge"); el.className = "livebadge";
    if (isNaN(t) || isNaN(s)) { el.textContent = ""; return; }
    if (t <= s) { el.classList.add("ok"); el.textContent = "✓ Conforme (≤ " + s + " °C)"; }
    else { el.classList.add("bad"); el.textContent = "✕ Non conforme (> " + s + " °C)"; }
  }
  $("#formTemp").addEventListener("submit", e => {
    e.preventDefault();
    const temp = parseFloat($("#tTemp").value);
    if (isNaN(temp)) { toast("Température manquante"); return; }
    const seuilRaw = $("#tSeuil").value.trim();
    const seuil = seuilRaw === "" ? "" : parseFloat(seuilRaw);
    const conf = seuil === "" ? null : temp <= seuil;
    const dv = $("#tDate").value;
    state.temp.push({ id: uid(), ts: dv ? new Date(dv).getTime() : Date.now(), zone: $("#tZone").value.trim() || "—", temp: temp, seuil: seuil, conf: conf, note: $("#tNote").value.trim() });
    save("temp"); render("temp");
    $("#formTemp").reset(); $("#tDate").value = nowInput();
    $$("#tType button").forEach((x, i) => x.classList.toggle("is-active", i === 0)); $("#tSeuil").value = "4"; $("#tBadge").textContent = "";
    toast("Relevé ajouté");
  });

  /* ---------- Livraisons ---------- */
  let livConf = "auto";
  $("#lConf").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    livConf = b.dataset.v; $$("#lConf button").forEach(x => x.classList.toggle("is-active", x === b));
  });
  $("#formLiv").addEventListener("submit", e => {
    e.preventDefault();
    const temp = $("#lTemp").value.trim() === "" ? "" : parseFloat($("#lTemp").value);
    let conf = null;
    if (livConf === "auto") conf = temp === "" ? null : temp <= 4;
    else conf = livConf === "1";
    state.liv.push({ id: uid(), ts: Date.now(), fourn: $("#lFourn").value.trim(), prod: $("#lProd").value.trim(), temp: temp, dlc: $("#lDlc").value, conf: conf, note: $("#lNote").value.trim() });
    save("liv"); render("liv");
    $("#formLiv").reset(); livConf = "auto"; $$("#lConf button").forEach((x, i) => x.classList.toggle("is-active", i === 0));
    toast("Livraison enregistrée");
  });

  /* ---------- Scan ---------- */
  let html5qr = null, scanning = false, lastHit = { code: "", t: 0 };
  function setScanBtns(on) { $("#btnScanStart").hidden = on; $("#btnScanStop").hidden = !on; }
  function hint(msg, err) { const h = $("#scanHint"); h.textContent = msg; h.classList.toggle("err", !!err); }

  $("#btnScanStart").addEventListener("click", startScan);
  $("#btnScanStop").addEventListener("click", stopScan);

  function fmtName(res) {
    try { return (res && res.result && res.result.format && res.result.format.formatName) || ""; } catch (e) { return ""; }
  }
  function onHit(text, res) {
    const now = Date.now();
    if (text === lastHit.code && now - lastHit.t < 2500) return; // anti-doublon
    lastHit = { code: text, t: now };
    state.scan.push({ id: uid(), ts: now, code: text, format: fmtName(res), label: "" });
    save("scan"); render("scan");
    if (navigator.vibrate) navigator.vibrate(60);
    toast("Code enregistré : " + text);
  }
  async function startScan() {
    if (scanning) return;
    if (!window.Html5Qrcode) { hint("Scanner non disponible (script non chargé).", true); return; }
    let cfg = { fps: 10, qrbox: { width: 250, height: 160 }, aspectRatio: 1.4 };
    let ctorCfg = { verbose: false };
    if (window.Html5QrcodeSupportedFormats) {
      const F = window.Html5QrcodeSupportedFormats;
      ctorCfg.formatsToSupport = [F.QR_CODE, F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39, F.ITF, F.CODABAR].filter(x => x != null);
    }
    try {
      html5qr = new Html5Qrcode("reader", ctorCfg);
      await html5qr.start({ facingMode: "environment" }, cfg, onHit, function () {});
      scanning = true; setScanBtns(true); hint("Visez un code-barres ou un QR code.");
    } catch (err) {
      hint("Caméra indisponible : " + (err && err.message ? err.message : err) + " — utilisez la saisie manuelle.", true);
      setScanBtns(false); scanning = false;
    }
  }
  async function stopScan() {
    if (!html5qr || !scanning) { setScanBtns(false); return; }
    try { await html5qr.stop(); await html5qr.clear(); } catch (e) {}
    scanning = false; setScanBtns(false); hint("Scan arrêté.");
  }
  $("#formScan").addEventListener("submit", e => {
    e.preventDefault();
    const code = $("#sCode").value.trim(); if (!code) { toast("Code vide"); return; }
    state.scan.push({ id: uid(), ts: Date.now(), code: code, format: "Saisie manuelle", label: $("#sLabel").value.trim() });
    save("scan"); render("scan"); $("#formScan").reset(); toast("Code ajouté");
  });

  /* ---------- Exports ---------- */
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-export]"); if (!b) return;
    const m = b.dataset.mod, kind = b.dataset.export;
    if (!EX[m].data().length) { toast("Aucune donnée à exporter"); return; }
    if (kind === "csv") exportCSV(m);
    else if (kind === "pdf") exportPDF(m);
    else if (kind === "jpeg") exportJPEG(m);
  });
  function stamp() { const d = new Date(); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`; }
  function dl(blobUrl, name) { const a = document.createElement("a"); a.href = blobUrl; a.download = name; document.body.appendChild(a); a.click(); a.remove(); }

  function exportCSV(m) {
    const ex = EX[m], rows = ex.data().slice().sort((a, b) => b.ts - a.ts);
    const q = v => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
    const csv = [ex.head.map(q).join(";")].concat(rows.map(r => ex.row(r).map(q).join(";"))).join("\r\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    dl(url, `achille-${ex.file}-${stamp()}.csv`); setTimeout(() => URL.revokeObjectURL(url), 4000); toast("CSV exporté");
  }

  function exportPDF(m) {
    if (!window.jspdf || !window.jspdf.jsPDF) { toast("Module PDF non chargé"); return; }
    const ex = EX[m], rows = ex.data().slice().sort((a, b) => b.ts - a.ts);
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const W = doc.internal.pageSize.getWidth();
    doc.setFont("helvetica", "bold"); doc.setTextColor(46, 39, 96); doc.setFontSize(16);
    doc.text("Achille HACCP", 40, 46);
    doc.setFont("helvetica", "normal"); doc.setTextColor(90, 90, 110); doc.setFontSize(11);
    doc.text(ex.title, 40, 64);
    doc.setFontSize(9); doc.setTextColor(140, 140, 155);
    doc.text("Édité le " + fmtDT(Date.now()) + "  ·  " + rows.length + " ligne(s)", 40, 79);
    if (!doc.autoTable) { doc.save(`achille-${ex.file}-${stamp()}.pdf`); return; }
    doc.autoTable({
      head: [ex.head], body: rows.map(r => ex.row(r)), startY: 92, margin: { left: 40, right: 40 },
      styles: { fontSize: 9, cellPadding: 5, overflow: "linebreak" },
      headStyles: { fillColor: [46, 39, 96], textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [246, 245, 252] },
      didParseCell: function (d) {
        if (ex.confCol >= 0 && d.section === "body" && d.column.index === ex.confCol) {
          const v = d.cell.raw || "";
          if (/Non conf/i.test(v)) { d.cell.styles.textColor = [196, 59, 72]; d.cell.styles.fontStyle = "bold"; }
          else if (/Conforme/i.test(v)) { d.cell.styles.textColor = [18, 128, 90]; d.cell.styles.fontStyle = "bold"; }
        }
      }
    });
    doc.save(`achille-${ex.file}-${stamp()}.pdf`); toast("PDF exporté");
  }

  function exportJPEG(m) {
    if (!window.html2canvas) { toast("Module image non chargé"); return; }
    const target = { temp: "#expTemp", liv: "#expLiv", scan: "#expScan" }[m];
    const node = $(target);
    toast("Génération de l'image…");
    window.html2canvas(node, { scale: 2, backgroundColor: "#ffffff", useCORS: true }).then(canvas => {
      canvas.toBlob(blob => { const url = URL.createObjectURL(blob); dl(url, `achille-${EX[m].file}-${stamp()}.jpg`); setTimeout(() => URL.revokeObjectURL(url), 4000); toast("Image exportée"); }, "image/jpeg", 0.95);
    }).catch(() => toast("Échec de l'image"));
  }

  /* ---------- Feuille d'aide ---------- */
  function openHelp() { $("#helpSheet").hidden = false; }
  function closeHelp() { $("#helpSheet").hidden = true; }
  $("#btnHelp").addEventListener("click", openHelp);
  $("#btnHelp2").addEventListener("click", openHelp);
  $("#closeHelp").addEventListener("click", closeHelp);
  $("#helpSheet").addEventListener("click", e => { if (e.target.id === "helpSheet") closeHelp(); });

  /* ---------- Init ---------- */
  render("temp"); render("liv"); render("scan"); refreshHome();
})();
