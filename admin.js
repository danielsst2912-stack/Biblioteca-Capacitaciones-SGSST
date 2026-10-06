// Panel de administración – Biblioteca de capacitaciones SST
(function () {
  const cfg = window.APP_CONFIG;
  const { esc, fmtFecha, fmtFechaHora, fmtFechaSimple, makePad, exportPdf } = window.UI;
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const $ = (s) => document.querySelector(s);
  const S = { materiales: [], trabajadores: [], editMat: null, editTrab: null, acta: null };

  const setMsg = (sel, text, kind) => { const el = $(sel); el.textContent = text || ""; el.className = "msg" + (kind ? " " + kind : ""); };

  // ---------- Opciones de formularios ----------
  $("#mEst").innerHTML = '<option value="">—</option>' + cfg.ESTANDARES.map((e) => `<option>${esc(e)}</option>`).join("");
  $("#mAreas").innerHTML = cfg.AREAS.map((a) => `<label><input type="checkbox" value="${esc(a)}"> ${esc(a)}</label>`).join("");
  $("#tArea").innerHTML = '<option value="">—</option>' + cfg.AREAS.map((a) => `<option>${esc(a)}</option>`).join("");

  // ---------- Sesión ----------
  async function esAdmin() { const { data, error } = await sb.rpc("is_admin"); return !error && data === true; }
  function show(v) { $("#vLogin").hidden = v !== "login"; $("#vApp").hidden = v !== "app"; $("#who").hidden = v !== "app"; }

  async function iniciar() {
    const { data: { session } } = await sb.auth.getSession();
    if (session && (await esAdmin())) return entrar(session.user);
    show("login");
  }
  async function entrar(user) {
    $("#whoMail").textContent = user.email || "";
    show("app");
    await Promise.all([cargarMateriales(), cargarTrabajadores()]);
  }
  $("#fLogin").addEventListener("submit", async (e) => {
    e.preventDefault(); setMsg("#aMsg", "", "err");
    const { data, error } = await sb.auth.signInWithPassword({ email: $("#aMail").value.trim(), password: $("#aPass").value });
    if (error) return setMsg("#aMsg", "Correo o contraseña incorrectos.", "err");
    if (!(await esAdmin())) { await sb.auth.signOut(); return setMsg("#aMsg", "Esta cuenta no tiene permisos de administrador.", "err"); }
    $("#aPass").value = "";
    entrar(data.user);
  });
  $("#btnSalir").addEventListener("click", async () => { await sb.auth.signOut(); show("login"); });

  // ---------- Pestañas ----------
  document.querySelectorAll("nav.tabs button").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll("nav.tabs button").forEach((x) => x.setAttribute("aria-selected", x === b ? "true" : "false"));
    ["tBib", "tTrab", "tActas"].forEach((id) => ($("#" + id).hidden = id !== b.dataset.tab));
    if (b.dataset.tab === "tActas") llenarSelectorActas();
  }));

  // =====================================================================
  // Biblioteca
  // =====================================================================
  async function cargarMateriales() {
    const { data, error } = await sb.from("materiales").select("*, firmas(count)").order("created_at", { ascending: false });
    if (error) { $("#matRows").innerHTML = `<tr><td colspan="5">No se pudo cargar el material: ${esc(error.message)}</td></tr>`; return; }
    S.materiales = (data || []).map((m) => ({ ...m, n: (m.firmas && m.firmas[0] && m.firmas[0].count) || 0 }));
    renderMateriales();
  }

  function convocados(m) {
    const activos = S.trabajadores.filter((t) => t.activo);
    if (!m.areas || !m.areas.length) return activos;
    return activos.filter((t) => m.areas.includes(t.area));
  }

  function renderMateriales() {
    if (!S.materiales.length) { $("#matRows").innerHTML = '<tr><td colspan="5" class="stat">Aún no hay material. Suba el primero con el formulario.</td></tr>'; return; }
    $("#matRows").innerHTML = S.materiales.map((m) => {
      const conv = convocados(m).length, pc = conv ? Math.round((m.n / conv) * 100) : 0;
      return `<tr>
        <td><b>${esc(m.tema)}</b><div class="stat">${esc(m.areas && m.areas.length ? m.areas.join(", ") : "Todas las áreas")}${m.fecha_limite ? " · Límite " + fmtFechaSimple(m.fecha_limite) : ""}</div></td>
        <td>${esc(m.tipo)}</td>
        <td>${m.n} de ${conv}<div class="bar"><i style="width:${Math.min(pc, 100)}%"></i></div></td>
        <td><span class="badge ${m.publicado ? "ok" : "draft"}">${m.publicado ? "Publicado" : "Borrador"}</span></td>
        <td><div class="actions">
          <button class="sm" type="button" data-act="edit" data-id="${m.id}">Editar</button>
          <button class="sm" type="button" data-act="pub" data-id="${m.id}">${m.publicado ? "Ocultar" : "Publicar"}</button>
          <button class="sm" type="button" data-act="acta" data-id="${m.id}">Ver acta</button>
          <button class="sm danger" type="button" data-act="del" data-id="${m.id}" ${m.n ? 'disabled title="No se puede eliminar: ya tiene firmas. Use Ocultar."' : ""}>Eliminar</button>
        </div></td></tr>`;
    }).join("");
  }

  $("#matRows").addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-act]"); if (!b) return;
    const m = S.materiales.find((x) => x.id === b.dataset.id); if (!m) return;
    if (b.dataset.act === "edit") editarMaterial(m);
    if (b.dataset.act === "pub") {
      const { error } = await sb.from("materiales").update({ publicado: !m.publicado }).eq("id", m.id);
      if (error) alert("No se pudo cambiar el estado: " + error.message); else cargarMateriales();
    }
    if (b.dataset.act === "acta") { document.querySelector('nav.tabs button[data-tab="tActas"]').click(); $("#actaSel").value = m.id; generarActa(); }
    if (b.dataset.act === "del") {
      if (m.n) return;
      if (!confirm(`¿Eliminar "${m.tema}"? Esta acción no se puede deshacer.`)) return;
      const { error } = await sb.from("materiales").delete().eq("id", m.id);
      if (error) return alert("No se pudo eliminar: " + error.message);
      if (m.archivo_path) await sb.storage.from(cfg.BUCKET).remove([m.archivo_path]);
      cargarMateriales();
    }
  });

  function limpiarFormMat() {
    S.editMat = null; $("#fMat").reset(); $("#mPub").checked = true;
    $("#fMatTitle").textContent = "Subir material"; $("#btnCancelarMat").hidden = true; $("#mFileActual").textContent = "";
  }
  function editarMaterial(m) {
    S.editMat = m;
    $("#fMatTitle").textContent = "Editar material"; $("#btnCancelarMat").hidden = false;
    $("#mTema").value = m.tema || ""; $("#mTipo").value = m.tipo || "Capacitación"; $("#mDur").value = m.duracion_min || "";
    $("#mObj").value = m.objetivo || ""; $("#mDesc").value = m.descripcion || ""; $("#mFac").value = m.facilitador || "";
    $("#mEst").value = m.estandar || ""; $("#mLim").value = m.fecha_limite || ""; $("#mLink").value = m.enlace_url || "";
    $("#mPub").checked = !!m.publicado; $("#mFile").value = "";
    $("#mFileActual").textContent = m.archivo_nombre ? "Archivo actual: " + m.archivo_nombre + ". Si sube otro, lo reemplaza." : "";
    document.querySelectorAll("#mAreas input").forEach((i) => (i.checked = !!(m.areas && m.areas.includes(i.value))));
    setMsg("#mMsg", ""); window.scrollTo({ top: 0, behavior: "smooth" });
  }
  $("#btnCancelarMat").addEventListener("click", () => { limpiarFormMat(); setMsg("#mMsg", ""); });

  const nombreSeguro = (n) => n.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w.-]+/g, "_").slice(-120);

  $("#fMat").addEventListener("submit", async (e) => {
    e.preventDefault();
    const file = $("#mFile").files[0];
    const link = $("#mLink").value.trim();
    const editando = S.editMat;
    if (!file && !link && !(editando && editando.archivo_path)) return setMsg("#mMsg", "Adjunte un archivo o escriba un enlace.", "err");
    if (file && file.size > 50 * 1024 * 1024) return setMsg("#mMsg", "El archivo supera 50 MB. Comprímalo o súbalo a YouTube o Drive y use el enlace.", "err");
    const btn = $("#btnGuardarMat"); btn.disabled = true;
    try {
      const areas = Array.from(document.querySelectorAll("#mAreas input:checked")).map((i) => i.value);
      const row = {
        tema: $("#mTema").value.trim(), tipo: $("#mTipo").value,
        duracion_min: $("#mDur").value ? parseInt($("#mDur").value, 10) : null,
        objetivo: $("#mObj").value.trim() || null, descripcion: $("#mDesc").value.trim() || null,
        facilitador: $("#mFac").value.trim() || null, estandar: $("#mEst").value || null,
        fecha_limite: $("#mLim").value || null, areas: areas.length ? areas : null,
        enlace_url: link || null, publicado: $("#mPub").checked,
      };
      let viejo = null;
      if (file) {
        setMsg("#mMsg", "Subiendo archivo…");
        const path = `${crypto.randomUUID()}/${nombreSeguro(file.name)}`;
        const { error: upErr } = await sb.storage.from(cfg.BUCKET).upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
        if (upErr) throw new Error("No se pudo subir el archivo: " + upErr.message);
        Object.assign(row, { archivo_path: path, archivo_nombre: file.name, archivo_tipo: file.type || "application/octet-stream" });
        if (editando && editando.archivo_path) viejo = editando.archivo_path;
      }
      if (editando) {
        const { error } = await sb.from("materiales").update(row).eq("id", editando.id);
        if (error) throw error;
        if (viejo) await sb.storage.from(cfg.BUCKET).remove([viejo]);
      } else {
        const { data: u } = await sb.auth.getUser();
        const { error } = await sb.from("materiales").insert({ ...row, created_by: u.user ? u.user.id : null });
        if (error) throw error;
      }
      limpiarFormMat();
      setMsg("#mMsg", editando ? "Material actualizado." : "Material guardado.", "ok");
      cargarMateriales();
    } catch (err) { setMsg("#mMsg", err.message || "No se pudo guardar.", "err"); }
    finally { btn.disabled = false; }
  });

  // =====================================================================
  // Trabajadores
  // =====================================================================
  async function cargarTrabajadores() {
    const { data, error } = await sb.from("trabajadores").select("id,cedula,nombre,cargo,area,sede,activo,bloqueado_hasta").order("nombre");
    if (error) { $("#trabRows").innerHTML = `<tr><td colspan="6">No se pudo cargar: ${esc(error.message)}</td></tr>`; return; }
    S.trabajadores = data || [];
    const act = S.trabajadores.filter((t) => t.activo).length;
    $("#tCount").textContent = `(${act} activos de ${S.trabajadores.length})`;
    $("#trabRows").innerHTML = S.trabajadores.length ? S.trabajadores.map((t) => {
      const bloq = t.bloqueado_hasta && new Date(t.bloqueado_hasta) > new Date();
      return `<tr><td>${esc(t.nombre)}</td><td>${esc(t.cedula)}</td><td>${esc(t.cargo)}</td><td>${esc(t.area)}</td>
        <td><span class="badge ${t.activo ? (bloq ? "pend" : "ok") : "draft"}">${t.activo ? (bloq ? "Bloqueado 15 min" : "Activo") : "Inactivo"}</span></td>
        <td><button class="sm" type="button" data-id="${t.id}">Editar</button></td></tr>`;
    }).join("") : '<tr><td colspan="6" class="stat">Aún no hay trabajadores. Agréguelos uno por uno o cárguelos en bloque.</td></tr>';
    renderMateriales();
  }

  $("#trabRows").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-id]"); if (!b) return;
    const t = S.trabajadores.find((x) => x.id === b.dataset.id); if (!t) return;
    S.editTrab = t;
    $("#fTrabTitle").textContent = "Editar trabajador"; $("#btnCancelarTrab").hidden = false;
    $("#tCed").value = t.cedula; $("#tNom").value = t.nombre; $("#tCar").value = t.cargo || ""; $("#tArea").value = t.area || "";
    $("#tSede").value = t.sede || ""; $("#tAct").checked = t.activo; $("#tPin").value = "";
    $("#tPinHelp").textContent = "Deje el PIN vacío para conservar el actual, o escriba uno nuevo para cambiarlo. Guardar también desbloquea el acceso.";
    setMsg("#tMsg", ""); window.scrollTo({ top: 0, behavior: "smooth" });
  });
  function limpiarFormTrab() {
    S.editTrab = null; $("#fTrab").reset(); $("#tAct").checked = true;
    $("#fTrabTitle").textContent = "Agregar trabajador"; $("#btnCancelarTrab").hidden = true;
    $("#tPinHelp").textContent = "El trabajador usa este PIN para ingresar. Entrégueselo de forma privada.";
  }
  $("#btnCancelarTrab").addEventListener("click", () => { limpiarFormTrab(); setMsg("#tMsg", ""); });

  async function guardarTrabajador(t) {
    const { error } = await sb.rpc("admin_guardar_trabajador", {
      p_id: t.id || null, p_cedula: t.cedula, p_nombre: t.nombre, p_cargo: t.cargo || null,
      p_area: t.area || null, p_sede: t.sede || null, p_pin: t.pin || null, p_activo: t.activo !== false,
    });
    if (error) throw new Error(error.message);
  }

  $("#fTrab").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pin = $("#tPin").value.trim();
    if (!S.editTrab && !/^\d{4,8}$/.test(pin)) return setMsg("#tMsg", "Escriba un PIN de 4 a 8 dígitos.", "err");
    if (S.editTrab && pin && !/^\d{4,8}$/.test(pin)) return setMsg("#tMsg", "El PIN debe tener de 4 a 8 dígitos.", "err");
    try {
      await guardarTrabajador({ id: S.editTrab && S.editTrab.id, cedula: $("#tCed").value.trim(), nombre: $("#tNom").value.trim(),
        cargo: $("#tCar").value.trim(), area: $("#tArea").value, sede: $("#tSede").value.trim(), pin, activo: $("#tAct").checked });
      const fueEdicion = !!S.editTrab; limpiarFormTrab();
      setMsg("#tMsg", fueEdicion ? "Trabajador actualizado." : "Trabajador guardado.", "ok");
      cargarTrabajadores();
    } catch (err) { setMsg("#tMsg", err.message, "err"); }
  });

  $("#btnBulk").addEventListener("click", async () => {
    const lines = $("#tBulk").value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return setMsg("#bMsg", "Pegue al menos una fila.", "err");
    let ok = 0; const fallos = [];
    for (const [i, l] of lines.entries()) {
      const [cedula, nombre, cargo, area, sede, pin] = l.split(/;|\t/).map((x) => (x || "").trim());
      if (!cedula || !nombre || !/^\d{4,8}$/.test(pin || "")) { fallos.push(`fila ${i + 1}: faltan datos o el PIN no tiene 4 a 8 dígitos`); continue; }
      try { await guardarTrabajador({ cedula, nombre, cargo, area, sede, pin, activo: true }); ok++; }
      catch (err) { fallos.push(`fila ${i + 1}: ${err.message}`); }
    }
    setMsg("#bMsg", `${ok} trabajadores cargados.` + (fallos.length ? " No se cargaron: " + fallos.join("; ") : ""), fallos.length ? "err" : "ok");
    if (ok) { $("#tBulk").value = fallos.length ? $("#tBulk").value : ""; cargarTrabajadores(); }
  });

  // =====================================================================
  // Actas automáticas
  // =====================================================================
  function llenarSelectorActas() {
    const actual = $("#actaSel").value;
    $("#actaSel").innerHTML = '<option value="">Seleccione…</option>' + S.materiales.map((m) =>
      `<option value="${m.id}">${esc(m.tema)} (${m.n} firmas)</option>`).join("");
    if (actual) $("#actaSel").value = actual;
  }
  $("#actaSel").addEventListener("change", generarActa);
  $("#actaPend").addEventListener("change", () => S.acta && renderActa());

  async function generarActa() {
    const id = $("#actaSel").value;
    ["#btnPdf", "#btnPrint", "#btnCsv"].forEach((b) => ($(b).disabled = !id));
    if (!id) { $("#actaWrap").innerHTML = ""; S.acta = null; return; }
    setMsg("#actaMsg", "Generando acta…");
    const m = S.materiales.find((x) => x.id === id);
    const { data, error } = await sb.from("firmas")
      .select("trabajador_id,cedula,nombre,cargo,area,sede,firma_png,firmado_en,visto_en")
      .eq("material_id", id).order("firmado_en");
    if (error) return setMsg("#actaMsg", "No se pudieron leer las firmas: " + error.message, "err");
    S.acta = { m, firmas: data || [] };
    setMsg("#actaMsg", "");
    renderActa();
  }

  function renderActa() {
    const { m, firmas } = S.acta;
    const conv = convocados(m);
    const firmaron = new Set(firmas.map((f) => f.trabajador_id));
    const pendientes = conv.filter((t) => !firmaron.has(t.id));
    const total = Math.max(conv.length, firmas.length);
    const pc = total ? Math.round((firmas.length / total) * 100) : 0;
    const numero = String(m.consecutivo).padStart(4, "0");
    const hoy = fmtFecha(new Date());
    const filas = firmas.map((f, i) => `<tr>
      <td>${i + 1}</td><td>${esc(f.nombre)}</td><td>${esc(f.cedula)}</td><td>${esc(f.cargo)}</td>
      <td>${esc([f.area, f.sede].filter(Boolean).join(" / "))}</td><td>${esc(fmtFechaHora(f.firmado_en))}</td>
      <td>${f.visto_en ? "Sí, " + esc(fmtFecha(f.visto_en)) : "No"}</td>
      <td class="firma"><img src="${esc(f.firma_png)}" alt="Firma de ${esc(f.nombre)}"></td></tr>`).join("")
      || '<tr><td colspan="8">Aún no hay firmas registradas.</td></tr>';
    const pend = $("#actaPend").checked && pendientes.length
      ? `<h3>Trabajadores pendientes (${pendientes.length})</h3><p style="font-size:13.5px">${pendientes.map((t) => esc(t.nombre) + (t.area ? " (" + esc(t.area) + ")" : "")).join("; ")}.</p>` : "";

    $("#actaWrap").innerHTML = `<div class="acta" id="acta">
      <div class="hdr">
        <div class="lg"><img src="logo.png" alt="Puppy Export"></div>
        <div class="tt"><b>Acta de ${esc(m.tipo.toLowerCase())}</b><small>${esc(cfg.EMPRESA)} · NIT ${esc(cfg.NIT)}</small></div>
        <div><dl class="ctl"><dt>Código</dt><dd>${esc(cfg.CODIGO_ACTA)}</dd><dt>Versión</dt><dd>${esc(cfg.VERSION_ACTA)}</dd>
          <dt>Acta N°</dt><dd>${numero}</dd><dt>Generada</dt><dd>${hoy}</dd></dl></div>
      </div>
      <h3>Datos de la actividad</h3>
      <div class="datos">
        <div>Tema</div><div><b>${esc(m.tema)}</b></div>
        <div>Tipo</div><div>${esc(m.tipo)}</div>
        <div>Objetivo</div><div>${esc(m.objetivo || "—")}</div>
        <div>Contenidos</div><div>${esc(m.descripcion || "—")}</div>
        <div>Facilitador</div><div>${esc(m.facilitador || "—")}</div>
        <div>Duración</div><div>${m.duracion_min ? m.duracion_min + " minutos" : "—"}</div>
        <div>Modalidad</div><div>Virtual, por la biblioteca de capacitaciones SST</div>
        <div>Publicado el</div><div>${esc(fmtFecha(m.created_at))}${m.fecha_limite ? " · Fecha límite " + esc(fmtFechaSimple(m.fecha_limite)) : ""}</div>
        <div>Dirigido a</div><div>${esc(m.areas && m.areas.length ? m.areas.join(", ") : "Todas las áreas")}</div>
        <div>Estándar</div><div>${esc(m.estandar || "—")}</div>
      </div>
      <h3>Cobertura</h3>
      <div class="kpis">
        <div class="kpi"><b>${total}</b><span>Trabajadores convocados</span></div>
        <div class="kpi"><b>${firmas.length}</b><span>Firmaron la asistencia</span></div>
        <div class="kpi"><b>${pc}%</b><span>Cobertura</span></div>
      </div>
      <h3>Registro de asistentes</h3>
      <div class="tw"><table>
        <thead><tr><th>N°</th><th>Nombre</th><th>Cédula</th><th>Cargo</th><th>Área / sede</th><th>Fecha y hora de firma</th><th>Revisó el material</th><th>Firma</th></tr></thead>
        <tbody>${filas}</tbody></table></div>
      ${pend}
      <h3>Responsable</h3>
      <div class="resp">
        <div><div class="pad" id="padResp"><canvas width="600" height="200" aria-label="Firma del responsable del SG-SST"></canvas><span class="hint no-pdf">Firma del responsable del SG-SST</span></div>
          <button class="link no-pdf no-print" type="button" id="btnBorrarResp">Borrar firma</button></div>
        <div><label class="f"><span>Nombre</span><input type="text" id="respNom"></label>
          <label class="f"><span>Cargo y licencia SST</span><input type="text" id="respCar" value="Responsable del SG-SST · Licencia N° "></label></div>
      </div>
      <p class="nota">Cada trabajador firmó electrónicamente esta asistencia con su cédula y PIN personal antes de acceder al material. La fecha, hora y firma quedan registradas en la base de datos de la empresa. Este registro se conserva según el procedimiento SST-PRO-001.</p>
    </div>`;
    const padResp = $("#padResp");
    const p = makePad(padResp.querySelector("canvas"), (s) => padResp.classList.toggle("signed", s));
    $("#btnBorrarResp").addEventListener("click", () => p.clear());
  }

  $("#btnPdf").addEventListener("click", async () => {
    if (!S.acta) return;
    if (!window.html2canvas || !window.jspdf) return setMsg("#actaMsg", "No se cargó el generador de PDF. Use Imprimir y elija Guardar como PDF.", "err");
    $("#btnPdf").disabled = true; setMsg("#actaMsg", "Generando PDF…");
    try {
      const tema = S.acta.m.tema.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w]+/g, "_").slice(0, 60);
      await exportPdf($("#acta"), `${cfg.CODIGO_ACTA}_Acta_${String(S.acta.m.consecutivo).padStart(4, "0")}_${tema}.pdf`);
      setMsg("#actaMsg", "PDF descargado.", "ok");
    } catch (err) { setMsg("#actaMsg", "No se pudo generar el PDF. Use Imprimir y elija Guardar como PDF.", "err"); }
    finally { $("#btnPdf").disabled = false; }
  });
  $("#btnPrint").addEventListener("click", () => window.print());
  $("#btnCsv").addEventListener("click", () => {
    if (!S.acta) return;
    const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = [["N°", "Nombre", "Cédula", "Cargo", "Área", "Sede", "Fecha y hora de firma", "Revisó el material"]]
      .concat(S.acta.firmas.map((f, i) => [i + 1, f.nombre, f.cedula, f.cargo, f.area, f.sede, fmtFechaHora(f.firmado_en), f.visto_en ? fmtFechaHora(f.visto_en) : "No"]));
    const csv = "\ufeff" + rows.map((r) => r.map(q).join(";")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `Firmantes_${String(S.acta.m.consecutivo).padStart(4, "0")}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
  });

  // Mantener sesión sincronizada
  sb.auth.onAuthStateChange((evt) => { if (evt === "SIGNED_OUT") show("login"); });
  iniciar();
})();
