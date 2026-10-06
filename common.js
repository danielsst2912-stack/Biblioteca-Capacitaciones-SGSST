// Utilidades compartidas
(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtFecha = (d) => d ? new Date(d).toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Bogota" }) : "";
  const fmtFechaHora = (d) => d ? new Date(d).toLocaleString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "America/Bogota" }) : "";
  const fmtFechaSimple = (s) => { if (!s) return ""; const [y, m, d] = String(s).split("-"); return `${d}/${m}/${y}`; };

  // Recuadro de firma con dedo o mouse
  function makePad(canvas, onChange) {
    const ctx = canvas.getContext("2d");
    ctx.lineWidth = 2.6; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#14193A";
    let drawing = false, last = null, dirty = false;
    const pt = (e) => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * canvas.width / r.width, y: (e.clientY - r.top) * canvas.height / r.height }; };
    canvas.addEventListener("pointerdown", (e) => { drawing = true; last = pt(e); canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener("pointermove", (e) => {
      if (!drawing) return;
      const q = pt(e); ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(q.x, q.y); ctx.stroke(); last = q;
      if (!dirty) { dirty = true; onChange && onChange(true); }
    });
    const end = () => { drawing = false; };
    canvas.addEventListener("pointerup", end); canvas.addEventListener("pointercancel", end);
    return {
      clear() { ctx.clearRect(0, 0, canvas.width, canvas.height); dirty = false; onChange && onChange(false); },
      isEmpty: () => !dirty,
      toPNG: () => canvas.toDataURL("image/png"),
    };
  }

  // Exporta un elemento HTML a PDF tamaño carta (html2canvas + jsPDF)
  async function exportPdf(el, filename) {
    document.body.classList.add("pdf-mode");
    try {
      const canvas = await html2canvas(el, { scale: 2, backgroundColor: "#ffffff", windowWidth: 1100, useCORS: true });
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ unit: "mm", format: "letter", orientation: "portrait" });
      const pw = 215.9, ph = 279.4, m = 10, iw = pw - 2 * m, ih = ph - 2 * m;
      const pxPerMm = canvas.width / iw, pagePx = Math.floor(ih * pxPerMm);
      let y = 0, first = true;
      while (y < canvas.height) {
        const h = Math.min(pagePx, canvas.height - y);
        const part = document.createElement("canvas"); part.width = canvas.width; part.height = h;
        part.getContext("2d").drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
        if (!first) pdf.addPage(); first = false;
        pdf.addImage(part.toDataURL("image/jpeg", 0.92), "JPEG", m, m, iw, h / pxPerMm);
        y += h;
      }
      pdf.save(filename);
    } finally {
      document.body.classList.remove("pdf-mode");
    }
  }

  window.UI = { esc, fmtFecha, fmtFechaHora, fmtFechaSimple, makePad, exportPdf };
})();
