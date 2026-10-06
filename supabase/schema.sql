-- =====================================================================
-- Biblioteca de capacitaciones SG-SST – Puppy Export
-- INVERSIONES DORADO PET S.A.S. / INTERNATIONAL PUPPY EXPORT S.A.S.
-- Ejecutar completo en: Supabase > SQL Editor > New query > Run
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- 1. Tablas
-- ---------------------------------------------------------------------

-- Administradores (usuarios de Supabase Auth con permisos de gestión)
create table if not exists public.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  nombre     text,
  created_at timestamptz not null default now()
);

-- Trabajadores (ingresan con cédula + PIN, sin cuenta de correo)
create table if not exists public.trabajadores (
  id                uuid primary key default gen_random_uuid(),
  cedula            text not null unique,
  nombre            text not null,
  cargo             text,
  area              text,
  sede              text,
  pin_hash          text not null,
  activo            boolean not null default true,
  intentos_fallidos int not null default 0,
  bloqueado_hasta   timestamptz,
  created_at        timestamptz not null default now()
);

-- Material de capacitación / socialización
create table if not exists public.materiales (
  id             uuid primary key default gen_random_uuid(),
  consecutivo    bigint generated always as identity,
  tema           text not null,
  tipo           text not null default 'Capacitación'
                 check (tipo in ('Capacitación','Socialización','Inducción','Reinducción','Otro')),
  objetivo       text,
  descripcion    text,
  estandar       text,
  facilitador    text,
  duracion_min   int,
  areas          text[],          -- vacío o null = dirigido a todas las áreas
  fecha_limite   date,
  archivo_path   text,            -- ruta en el bucket "materiales"
  archivo_nombre text,
  archivo_tipo   text,            -- tipo MIME
  enlace_url     text,            -- alternativa: enlace externo (YouTube, Drive, etc.)
  publicado      boolean not null default false,
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now()
);

-- Firmas de asistencia (evidencia: no se editan ni se borran)
create table if not exists public.firmas (
  id            uuid primary key default gen_random_uuid(),
  material_id   uuid not null references public.materiales(id) on delete restrict,
  trabajador_id uuid not null references public.trabajadores(id) on delete restrict,
  -- copia de los datos del trabajador al momento de firmar
  cedula        text not null,
  nombre        text not null,
  cargo         text,
  area          text,
  sede          text,
  firma_png     text not null,     -- imagen de la firma (data URL PNG)
  declaracion   boolean not null default true,
  firmado_en    timestamptz not null default now(),
  visto_en      timestamptz,       -- cuándo marcó que terminó de revisar el material
  user_agent    text,
  unique (material_id, trabajador_id)
);
create index if not exists firmas_material_idx on public.firmas(material_id);

-- Sesiones de trabajadores (token temporal de 8 horas)
create table if not exists public.sesiones_trabajador (
  token         uuid primary key default gen_random_uuid(),
  trabajador_id uuid not null references public.trabajadores(id) on delete cascade,
  expira_en     timestamptz not null default now() + interval '8 hours'
);

-- ---------------------------------------------------------------------
-- 2. Seguridad (RLS)
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

alter table public.admins              enable row level security;
alter table public.trabajadores        enable row level security;
alter table public.materiales          enable row level security;
alter table public.firmas              enable row level security;
alter table public.sesiones_trabajador enable row level security;

drop policy if exists "admin ve su registro" on public.admins;
create policy "admin ve su registro" on public.admins
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "admin gestiona trabajadores" on public.trabajadores;
create policy "admin gestiona trabajadores" on public.trabajadores
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin gestiona materiales" on public.materiales;
create policy "admin gestiona materiales" on public.materiales
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Las firmas solo se leen; se crean a través de la función trabajador_firmar
drop policy if exists "admin lee firmas" on public.firmas;
create policy "admin lee firmas" on public.firmas
  for select to authenticated using (public.is_admin());

-- sesiones_trabajador: sin políticas = nadie accede directamente

-- ---------------------------------------------------------------------
-- 3. Funciones de administración
-- ---------------------------------------------------------------------
create or replace function public.admin_guardar_trabajador(
  p_id uuid, p_cedula text, p_nombre text, p_cargo text, p_area text,
  p_sede text, p_pin text, p_activo boolean default true)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'No autorizado'; end if;
  if coalesce(trim(p_cedula),'') = '' or coalesce(trim(p_nombre),'') = '' then
    raise exception 'La cédula y el nombre son obligatorios';
  end if;
  if p_id is null then
    if p_pin is null or length(p_pin) < 4 then
      raise exception 'El PIN debe tener al menos 4 dígitos';
    end if;
    insert into public.trabajadores (cedula, nombre, cargo, area, sede, pin_hash, activo)
    values (trim(p_cedula), trim(p_nombre), p_cargo, p_area, p_sede,
            crypt(p_pin, gen_salt('bf')), coalesce(p_activo, true))
    on conflict (cedula) do update
      set nombre = excluded.nombre, cargo = excluded.cargo, area = excluded.area,
          sede = excluded.sede, pin_hash = excluded.pin_hash, activo = excluded.activo,
          intentos_fallidos = 0, bloqueado_hasta = null
    returning id into v_id;
  else
    update public.trabajadores
       set cedula = trim(p_cedula), nombre = trim(p_nombre), cargo = p_cargo,
           area = p_area, sede = p_sede, activo = coalesce(p_activo, true),
           pin_hash = case when p_pin is not null and length(p_pin) >= 4
                           then crypt(p_pin, gen_salt('bf')) else pin_hash end,
           intentos_fallidos = 0, bloqueado_hasta = null
     where id = p_id
    returning id into v_id;
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 4. Funciones para el portal de trabajadores (acceso con cédula + PIN)
-- ---------------------------------------------------------------------
create or replace function public._sesion(p_token uuid)
returns public.trabajadores language sql stable security definer set search_path = public as $$
  select t.* from public.sesiones_trabajador s
    join public.trabajadores t on t.id = s.trabajador_id
   where s.token = p_token and s.expira_en > now() and t.activo
   limit 1;
$$;
revoke execute on function public._sesion(uuid) from public, anon, authenticated;

create or replace function public.trabajador_iniciar_sesion(p_cedula text, p_pin text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare t public.trabajadores; v_token uuid;
begin
  select * into t from public.trabajadores where cedula = trim(p_cedula) and activo;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Cédula o PIN incorrectos.');
  end if;
  if t.bloqueado_hasta is not null and t.bloqueado_hasta > now() then
    return jsonb_build_object('ok', false,
      'error', 'Acceso bloqueado por varios intentos fallidos. Intente de nuevo en 15 minutos.');
  end if;
  if t.pin_hash <> crypt(coalesce(p_pin,''), t.pin_hash) then
    update public.trabajadores
       set intentos_fallidos = intentos_fallidos + 1,
           bloqueado_hasta = case when intentos_fallidos + 1 >= 5
                                  then now() + interval '15 minutes' end
     where id = t.id;
    return jsonb_build_object('ok', false, 'error', 'Cédula o PIN incorrectos.');
  end if;
  update public.trabajadores set intentos_fallidos = 0, bloqueado_hasta = null where id = t.id;
  delete from public.sesiones_trabajador where expira_en < now();
  insert into public.sesiones_trabajador (trabajador_id) values (t.id) returning token into v_token;
  return jsonb_build_object('ok', true, 'token', v_token,
    'trabajador', jsonb_build_object('nombre', t.nombre, 'cargo', t.cargo, 'area', t.area, 'sede', t.sede));
end $$;

create or replace function public.trabajador_cerrar_sesion(p_token uuid)
returns jsonb language sql security definer set search_path = public as $$
  delete from public.sesiones_trabajador where token = p_token;
  select jsonb_build_object('ok', true);
$$;

create or replace function public.trabajador_materiales(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_t public.trabajadores;
begin
  v_t := public._sesion(p_token);
  if v_t.id is null then
    return jsonb_build_object('ok', false, 'code', 'sesion', 'error', 'Su sesión terminó. Ingrese de nuevo.');
  end if;
  return jsonb_build_object('ok', true, 'materiales', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', m.id, 'tema', m.tema, 'tipo', m.tipo, 'objetivo', m.objetivo,
             'descripcion', m.descripcion, 'facilitador', m.facilitador,
             'duracion_min', m.duracion_min, 'fecha_limite', m.fecha_limite,
             'publicado_en', m.created_at, 'firmado_en', f.firmado_en, 'visto_en', f.visto_en)
           order by (f.firmado_en is not null), m.created_at desc)
      from public.materiales m
      left join public.firmas f on f.material_id = m.id and f.trabajador_id = v_t.id
     where m.publicado
       and (m.areas is null or cardinality(m.areas) = 0 or v_t.area = any(m.areas))
  ), '[]'::jsonb));
end $$;

create or replace function public.trabajador_firmar(
  p_token uuid, p_material_id uuid, p_firma text, p_user_agent text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_t public.trabajadores; v_m public.materiales;
begin
  v_t := public._sesion(p_token);
  if v_t.id is null then
    return jsonb_build_object('ok', false, 'code', 'sesion', 'error', 'Su sesión terminó. Ingrese de nuevo.');
  end if;
  select * into v_m from public.materiales
   where id = p_material_id and publicado
     and (areas is null or cardinality(areas) = 0 or v_t.area = any(areas));
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Este material ya no está disponible.');
  end if;
  if p_firma is null or left(p_firma, 22) <> 'data:image/png;base64,' or length(p_firma) > 400000 then
    return jsonb_build_object('ok', false, 'error', 'La firma no es válida. Firme de nuevo.');
  end if;
  insert into public.firmas (material_id, trabajador_id, cedula, nombre, cargo, area, sede, firma_png, user_agent)
  values (v_m.id, v_t.id, v_t.cedula, v_t.nombre, v_t.cargo, v_t.area, v_t.sede, p_firma, left(p_user_agent, 300))
  on conflict (material_id, trabajador_id) do nothing;
  return jsonb_build_object('ok', true, 'archivo_path', v_m.archivo_path, 'archivo_nombre', v_m.archivo_nombre,
                            'archivo_tipo', v_m.archivo_tipo, 'enlace_url', v_m.enlace_url);
end $$;

create or replace function public.trabajador_abrir_material(p_token uuid, p_material_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_t public.trabajadores; v_m public.materiales;
begin
  v_t := public._sesion(p_token);
  if v_t.id is null then
    return jsonb_build_object('ok', false, 'code', 'sesion', 'error', 'Su sesión terminó. Ingrese de nuevo.');
  end if;
  if not exists (select 1 from public.firmas where material_id = p_material_id and trabajador_id = v_t.id) then
    return jsonb_build_object('ok', false, 'error', 'Debe firmar la asistencia antes de ver el material.');
  end if;
  select * into v_m from public.materiales where id = p_material_id;
  return jsonb_build_object('ok', true, 'archivo_path', v_m.archivo_path, 'archivo_nombre', v_m.archivo_nombre,
                            'archivo_tipo', v_m.archivo_tipo, 'enlace_url', v_m.enlace_url);
end $$;

create or replace function public.trabajador_marcar_visto(p_token uuid, p_material_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_t public.trabajadores;
begin
  v_t := public._sesion(p_token);
  if v_t.id is null then
    return jsonb_build_object('ok', false, 'code', 'sesion', 'error', 'Su sesión terminó. Ingrese de nuevo.');
  end if;
  update public.firmas set visto_en = coalesce(visto_en, now())
   where material_id = p_material_id and trabajador_id = v_t.id;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.trabajador_iniciar_sesion(text, text) to anon, authenticated;
grant execute on function public.trabajador_cerrar_sesion(uuid) to anon, authenticated;
grant execute on function public.trabajador_materiales(uuid) to anon, authenticated;
grant execute on function public.trabajador_firmar(uuid, uuid, text, text) to anon, authenticated;
grant execute on function public.trabajador_abrir_material(uuid, uuid) to anon, authenticated;
grant execute on function public.trabajador_marcar_visto(uuid, uuid) to anon, authenticated;
grant execute on function public.admin_guardar_trabajador(uuid, text, text, text, text, text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Almacenamiento de archivos
-- ---------------------------------------------------------------------
-- Bucket público de lectura: el enlace solo se entrega al trabajador después de firmar.
-- No suba documentos confidenciales a este bucket.
insert into storage.buckets (id, name, public, file_size_limit)
values ('materiales', 'materiales', true, 52428800)  -- 50 MB por archivo
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit;

drop policy if exists "admin sube materiales" on storage.objects;
create policy "admin sube materiales" on storage.objects
  for insert to authenticated with check (bucket_id = 'materiales' and public.is_admin());

drop policy if exists "admin actualiza materiales" on storage.objects;
create policy "admin actualiza materiales" on storage.objects
  for update to authenticated using (bucket_id = 'materiales' and public.is_admin());

drop policy if exists "admin borra materiales" on storage.objects;
create policy "admin borra materiales" on storage.objects
  for delete to authenticated using (bucket_id = 'materiales' and public.is_admin());

-- ---------------------------------------------------------------------
-- 6. Primer administrador
-- ---------------------------------------------------------------------
-- a) Cree el usuario en Authentication > Users > Add user (correo y contraseña).
-- b) Ejecute (cambiando el correo):
-- insert into public.admins (user_id, nombre)
-- select id, 'Responsable SG-SST' from auth.users where email = 'correo@puppyexport.com';
