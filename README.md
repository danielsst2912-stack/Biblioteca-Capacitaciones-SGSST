# Biblioteca de capacitaciones SST – Puppy Export

Aplicación web para publicar material de capacitación y socialización del SG-SST.
Cada trabajador **firma su asistencia antes de ver el material**, y el sistema
**genera el acta automáticamente** con las firmas, la fecha y la hora.

| Parte | Archivo | Quién la usa |
| --- | --- | --- |
| Portal de trabajadores | `trabajadores.html` (también abre desde `index.html`) | Los 38 trabajadores, desde el celular |
| Panel de administración | `admin.html` | Responsable del SG-SST |
| Base de datos | `supabase/schema.sql` | Se ejecuta una sola vez en Supabase |

## Cómo funciona

1. El administrador registra a los trabajadores con cédula y un PIN de 4 a 8 dígitos.
2. El administrador sube el material (PDF, video, imagen, Word, PowerPoint o un enlace de YouTube o Drive) y lo publica para todas las áreas o solo para algunas.
3. El trabajador entra con cédula y PIN, ve sus capacitaciones pendientes, acepta la declaración, firma con el dedo y solo entonces se abre el material. Al terminar marca "Terminé de revisar el material".
4. En la pestaña **Actas**, el administrador elige el material y obtiene el acta con logo y control documental (SST-FOR-013): datos de la actividad, cobertura, lista de firmantes con firma, fecha y hora, y pendientes. Se descarga en PDF, se imprime o se exporta a CSV.

## Instalación (unos 20 minutos)

### 1. Crear el proyecto en Supabase
1. Entre a https://supabase.com, cree una cuenta y un proyecto nuevo. Región sugerida: la más cercana disponible (por ejemplo, São Paulo).
2. Guarde la contraseña de la base de datos en un lugar seguro.

### 2. Crear la base de datos
1. Abra **SQL Editor > New query**.
2. Copie todo el contenido de `supabase/schema.sql`, péguelo y pulse **Run**.
3. Esto crea las tablas, la seguridad, las funciones y el bucket `materiales` para los archivos.

### 3. Crear el usuario administrador
1. Vaya a **Authentication > Users > Add user > Create new user**, con el correo y la contraseña del responsable del SG-SST. Marque "Auto Confirm User".
2. En **SQL Editor**, ejecute, cambiando el correo:
   ```sql
   insert into public.admins (user_id, nombre)
   select id, 'Responsable SG-SST' from auth.users where email = 'correo@puppyexport.com';
   ```
3. Recomendado: en **Authentication > Sign In / Providers > Email**, desactive "Allow new users to sign up". Así nadie más puede crear cuentas.

### 4. Conectar la aplicación
1. En **Project Settings > API**, copie la **Project URL** y la clave **anon public**.
2. Abra `config.js` y reemplace `SUPABASE_URL` y `SUPABASE_ANON_KEY`.
   La clave anon es pública por diseño: la seguridad la dan las reglas de la base de datos.

### 5. Publicar la página
Cualquier hosting de archivos estáticos con HTTPS sirve. La forma más simple:
1. Entre a https://app.netlify.com/drop.
2. Arrastre la carpeta completa del proyecto.
3. Netlify le da una dirección como `https://puppy-sst.netlify.app`.
   - Trabajadores: `https://puppy-sst.netlify.app/` (abre el portal)
   - Administrador: `https://puppy-sst.netlify.app/admin.html`

También funciona con Vercel, GitHub Pages o el hosting de su sitio web.

### 6. Empezar a usarla
1. Entre a `admin.html` y cargue a los trabajadores. Puede pegarlos en bloque con el formato `cédula;nombre;cargo;área;sede;PIN`.
2. Entregue a cada trabajador su PIN de forma privada.
3. Suba el primer material y comparta por WhatsApp el enlace del portal.

## Seguridad

- **Trabajadores sin correo:** entran con cédula y PIN. El PIN se guarda cifrado (bcrypt). Tras 5 intentos fallidos, el acceso se bloquea 15 minutos. La sesión dura 8 horas.
- **Acceso controlado por la base de datos:** los trabajadores no leen tablas directamente. Todo pasa por funciones que validan su sesión y su área.
- **Firmas como evidencia:** no se pueden editar ni borrar desde la aplicación. Un material con firmas no se puede eliminar, solo ocultar. Cada firma guarda una copia del nombre, cédula, cargo y área del momento en que se firmó.
- **Archivos:** el bucket `materiales` es de lectura pública. El enlace solo se muestra después de firmar, pero quien tenga el enlace puede abrir el archivo. No suba documentos confidenciales; para eso use enlaces de Drive con permisos restringidos.

## Aspectos legales para revisar

- **Firma electrónica:** el sistema usa una firma electrónica simple (cédula, PIN personal y trazo de firma con fecha y hora). En Colombia, la Ley 527 de 1999 y su reglamentación reconocen la firma electrónica cuando el método es confiable y apropiado. Conviene informar este mecanismo en la inducción y en el reglamento interno, y validarlo con su asesor jurídico.
- **Datos personales:** la firma y los datos de los trabajadores son datos personales (Ley 1581 de 2012). Incluya este uso en la autorización de tratamiento de datos.
- **Retención:** las actas son registros del SG-SST y se conservan 20 años (procedimiento SST-PRO-001). Descargue el PDF de cada acta al cerrar la actividad y guárdelo en el archivo del SG-SST. Además, active copias de seguridad en Supabase. Los proyectos del plan gratuito pueden pausarse por inactividad; para evidencias de largo plazo se recomienda un plan pago.

## Archivos del proyecto

```
index.html           Redirige al portal de trabajadores
trabajadores.html    Portal de trabajadores
trabajadores.js
admin.html           Panel de administración (biblioteca, trabajadores, actas)
admin.js
common.js            Firma con el dedo y exportación a PDF
config.js            Conexión a Supabase y listas (áreas, estándares)
styles.css
logo.png
supabase/schema.sql  Base de datos, seguridad, funciones y almacenamiento
```

Para cambiar las áreas o los estándares de las listas, edite `config.js`.
