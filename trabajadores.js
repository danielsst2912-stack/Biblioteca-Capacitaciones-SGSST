// Portal de trabajadores – Biblioteca de capacitaciones SST
(function () {
  const cfg = window.APP_CONFIG;
  const { esc, fmtFecha, fmtFechaSimple, makePad } = window.UI;
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const $ = (s) => document.querySelector(s);

  const S = {
    token: sessionStorage.getItem("pe_token"),
    me: JSON.parse(sessionStorage.getItem("pe_me") || "null"),
    materiales: [],
    actual: null,
  };

  function show(view) {
    ["#vLogin", "#vList", "#vDetail"].forEach((v) => ($(v).hidden = v !== view));
    $("#who").hidden = view === "#vLogin";
    window.scrollTo(0, 0);
  }

  async function rpc(name, args) {
    const { data, error } = await sb.rpc(name, args);
    if (error) throw new Error("No hay conexión con el servidor. Intente de nuevo.");
    if (data && data.ok === false) {
      if (data.code === "sesion") { salir(true); }
      throw new Error(data.error || "Ocurrió un error.");
    }
    return data;
  }

  // ---------- Ingreso ----------
  $("#fLogin").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#btnIngresar"); btn.disabled = true; $("#lMsg").textContent = "";
    try {
      const r = await rpc("trabajador_iniciar_sesion", { p_cedula: $("#lCed").value.trim(), p_pin: $("#lPin").value });
      S.token = r.token; S.me = r.trabajador;
      sessionStorage.setItem("pe_token", S.token); sessionStorage.setItem("pe_me", JSON.stringify(S.me));
      $("#lPin").value = "";
      await cargarLista();
    } catch (err) { $("#lMsg").textContent = err.message; }
    finally { btn.disabled = false; }
  });

  function salir(expirada) {
    if (S.token && !expirada) sb.rpc("trabajador_cerrar_sesion", { p_token: S.token });
    S.token = null; S.me = null;
    sessionStorage.removeItem("pe_token"); sessionStorage.removeItem("pe_me");
    $("#lMsg").textContent = expirada ? "Su sesión terminó. Ingrese de nuevo." : "";
    show("#vLogin");
  }
  $("#btnSalir").addEventListener("click", () => salir(false));

  // ---------- Biblioteca ----------
  async function cargarLista() {
    const r = await rpc("trabajador_materiales", { p_token: S.token });
    S.materiales = r.materiales || [];
    const nombre = (S.me && S.me.nombre) || "";
    $("#whoName").textContent = nombre;
    $("#hHola").textContent = "Hola, " + nombre.split(" ")[0];
    const pend = S.materiales.filter((m) => !m.firmado_en).length;
    $("#hResumen").textContent = pend === 0
      ? "Está al día: no tiene capacitaciones pendientes."
      : `Tiene ${pend} ${pend === 1 ? "capacitación pendiente" : "capacitaciones pendientes"}. Firme la asistencia para abrir cada material.`;
    const list = $("#list");
    if (!S.materiales.length) {
      list.innerHTML = '<div class="empty">Todavía no hay material publicado para su área.</div>';
    } else {
      list.innerHTML = S.materiales.map((m) => {
        const done = !!m.firmado_en;
        const meta = [m.tipo, m.duracion_min ? m.duracion_min + " min" : "", m.fecha_limite && !done ? "Fecha límite: " + fmtFechaSimple(m.fecha_limite) : "", done ? "Firmado el " + fmtFecha(m.firmado_en) : ""].filter(Boolean).join(" · ");
        return `<button type="button" class="mat ${done ? "done" : ""}" data-id="${esc(m.id)}">
          <span class="t">${esc(m.tema)}</span>
          <span class="badge ${done ? "ok" : "pend"}">${done ? "Firmado" : "Pendiente"}</span>
          <span class="m">${esc(meta)}</span></button>`;
      }).join("");
    }
    show("#vList");
  }
  $("#list").addEventListener("click", (e) => {
    const b = e.target.closest(".mat"); if (!b) return;
    abrirDetalle(S.materiales.find((m) => m.id === b.dataset.id));
  });
  $("#btnVolver").addEventListener("click", () => cargarLista().catch((err) => alert(err.message)));

  // ---------- Detalle y firma ----------
  const padEl = $("#pad");
  const pad = makePad(padEl.querySelector("canvas"), (signed) => { padEl.classList.toggle("signed", signed); validar(); });
  $("#btnBorrar").addEventListener("click", () => pad.clear());
  $("#chkDecl").addEventListener("change", validar);
  function validar() { $("#btnFirmar").disabled = pad.isEmpty() || !$("#chkDecl").checked; }

  function abrirDetalle(m) {
    if (!m) return;
    S.actual = m;
    $("#dTipo").textContent = m.tipo;
    $("#dTema").textContent = m.tema;
    $("#dMeta").textContent = [m.facilitador ? "Facilitador: " + m.facilitador : "", m.duracion_min ? "Duración: " + m.duracion_min + " minutos" : ""].filter(Boolean).join(" · ");
    $("#dObj").textContent = m.objetivo ? "Objetivo: " + m.objetivo : "";
    $("#dDesc").textContent = m.descripcion || "";
    $("#dDecl").textContent = `Yo, ${S.me.nombre}, declaro que recibo la ${m.tipo.toLowerCase()} "${m.tema}" y me comprometo a revisar el material completo y a aplicar lo aprendido en mi trabajo.`;
    $("#sMsg").textContent = ""; $("#vMsg").textContent = "";
    pad.clear(); $("#chkDecl").checked = false; validar();
    show("#vDetail");
    if (m.firmado_en) {
      $("#signBox").hidden = true;
      rpc("trabajador_abrir_material", { p_token: S.token, p_material_id: m.id })
        .then((acc) => mostrarMaterial(acc, false))
        .catch((err) => { $("#viewBox").hidden = false; $("#viewer").innerHTML = ""; $("#vMsg").textContent = err.message; });
    } else {
      $("#signBox").hidden = false; $("#viewBox").hidden = true;
    }
  }

  $("#btnFirmar").addEventListener("click", async () => {
    const btn = $("#btnFirmar"); btn.disabled = true; $("#sMsg").textContent = "";
    try {
      const acc = await rpc("trabajador_firmar", { p_token: S.token, p_material_id: S.actual.id, p_firma: pad.toPNG(), p_user_agent: navigator.userAgent });
      S.actual.firmado_en = new Date().toISOString();
      $("#signBox").hidden = true;
      mostrarMaterial(acc, true);
    } catch (err) { $("#sMsg").textContent = err.message; validar(); }
  });

  function embedYoutube(url) {
    const m = String(url).match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{6,})/);
    return m ? "https://www.youtube.com/embed/" + m[1] : null;
  }

  function mostrarMaterial(acc, recienFirmado) {
    $("#viewBox").hidden = false;
    $("#vOk").textContent = recienFirmado ? "Firma registrada. Ya puede revisar el material." : "Usted ya firmó esta asistencia.";
    const v = $("#viewer");
    let html = "";
    if (acc.archivo_path) {
      const url = sb.storage.from(cfg.BUCKET).getPublicUrl(acc.archivo_path).data.publicUrl;
      const t = acc.archivo_tipo || "";
      if (t === "application/pdf") html = `<div class="viewer"><iframe src="${esc(url)}" title="${esc(acc.archivo_nombre)}"></iframe></div><p><a href="${esc(url)}" target="_blank" rel="noopener">Abrir el PDF en otra pestaña</a></p>`;
      else if (t.startsWith("video/")) html = `<div class="viewer"><video src="${esc(url)}" controls playsinline preload="metadata"></video></div>`;
      else if (t.startsWith("image/")) html = `<div class="viewer"><img src="${esc(url)}" alt="${esc(acc.archivo_nombre)}"></div>`;
      else if (/officedocument|msword|ms-powerpoint|ms-excel/.test(t)) {
        const office = "https://view.officeapps.live.com/op/embed.aspx?src=" + encodeURIComponent(url);
        html = `<div class="viewer"><iframe src="${esc(office)}" title="${esc(acc.archivo_nombre)}"></iframe></div><p><a href="${esc(url)}" target="_blank" rel="noopener">Descargar ${esc(acc.archivo_nombre)}</a></p>`;
      } else html = `<div class="viewer doc"><a href="${esc(url)}" target="_blank" rel="noopener">Abrir ${esc(acc.archivo_nombre || "el material")}</a></div>`;
    }
    if (acc.enlace_url) {
      const yt = embedYoutube(acc.enlace_url);
      html += yt
        ? `<div class="viewer"><iframe src="${esc(yt)}" title="Video" allow="accelerometer; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`
        : `<div class="viewer doc"><a href="${esc(acc.enlace_url)}" target="_blank" rel="noopener">Abrir el material en otra pestaña</a></div>`;
    }
    v.innerHTML = html || '<div class="viewer doc">Este material no tiene archivo adjunto.</div>';
    const visto = S.actual && S.actual.visto_en;
    $("#btnVisto").hidden = !!visto;
    $("#vMsg").textContent = visto ? "Ya marcó este material como revisado." : "";
    $("#vMsg").className = "msg ok";
  }

  $("#btnVisto").addEventListener("click", async () => {
    try {
      await rpc("trabajador_marcar_visto", { p_token: S.token, p_material_id: S.actual.id });
      S.actual.visto_en = new Date().toISOString();
      $("#btnVisto").hidden = true;
      $("#vMsg").className = "msg ok"; $("#vMsg").textContent = "Gracias. Quedó registrado que revisó el material.";
    } catch (err) { $("#vMsg").className = "msg err"; $("#vMsg").textContent = err.message; }
  });

  // ---------- Inicio ----------
  if (S.token && S.me) cargarLista().catch(() => show("#vLogin"));
  else show("#vLogin");
})();
