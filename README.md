# VanguardIA — Cambre Planos Electricos (MVP)

Repo (MVP) organizado como **monorepo**.

## Estructura

- `apps/web`: Frontend React + Tailwind + Vite.
- `apps/api`: Backend Node + Express + TypeScript.
- `services/cad-worker`: Skeleton Python (CLI + healthcheck) con `pyproject.toml`.
- `docs/adr`: ADRs del diseño (ej. `ADR-001`).
- `docs/ci.md`: CI en GitHub Actions y notas de despliegue (placeholder).

## Requisitos

- Node.js 20+
- Python 3.12+
- (Opcional) Docker / Docker Compose

## Variables de entorno

```bash
cp .env.example .env
```

### Bootstrap seguro del primer Administrador (US-001)

En un despliegue fresh debe existir al menos un usuario con rol `administrator` para poder invitar al resto del equipo. El alta inicial se hace desde servidor con la Admin API de Supabase y la service role key; no se commitean secretos ni contraseñas.

1. Configura en el entorno de la API (local, staging o production):

```bash
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
BOOTSTRAP_ADMIN_EMAIL=admin@example.com
```

`SUPABASE_SERVICE_ROLE_KEY` y `BOOTSTRAP_ADMIN_EMAIL` son server-only. No uses prefijos `VITE_` / `NEXT_PUBLIC_` ni los expongas al navegador.

2. Ejecuta el bootstrap desde el repo:

```bash
npm --workspace api run bootstrap:admin
```

El script es idempotente: si el usuario no existe, crea un usuario confirmado para `BOOTSTRAP_ADMIN_EMAIL`; si ya existe, no duplica y asegura `app_metadata.role = "administrator"` preservando el resto de `app_metadata`.

3. Completa el acceso inicial con un enlace one-time:

- Con el front desplegado y Auth email/SMTP configurado en Supabase, abre `/forgot-password`, ingresa `BOOTSTRAP_ADMIN_EMAIL` y usa el enlace de recuperación recibido para definir la contraseña en `/reset-password`.
- Si el envío de emails todavía no está configurado, usa el Dashboard de Supabase Auth para iniciar un recovery/reset de password al mismo email. No pegues ni guardes links de recuperación en logs, issues o commits.

4. Inicia sesión con ese usuario. La API leerá primero `app_metadata.role`; con rol `administrator` el usuario queda operativo para invitar (dependencia US-001).

## Desarrollo local

### 1. Prerrequisitos

| Herramienta | Versión |
|-------------|---------|
| Node.js | 20+ |
| npm | 10+ (incluido con Node) |
| Python | 3.12+ (solo si vas a probar `cad-worker` / pipeline CAD) |
| [Supabase CLI](https://supabase.com/docs/guides/cli) | Para migraciones y `db push` |

### 2. Configuración inicial (una vez)

```bash
git clone git@github.com:juanchiriera/colocador-planos-electricos.git
cd colocador-planos-electricos
npm install
cp .env.example .env
```

Completa en `.env` (raíz) al menos:

| Variable | Uso |
|----------|-----|
| `SUPABASE_URL` | Proyecto Supabase |
| `SUPABASE_ANON_KEY` | Clave anon (web + API) |
| `SUPABASE_SERVICE_ROLE_KEY` | Solo servidor (storage, invitaciones, pipeline) |
| `VITE_API_URL` | `http://localhost:3001` en local |
| `CORS_ORIGIN` | Orígenes del front local (p. ej. `http://localhost:5173,http://localhost:5174`) |
| `PUBLIC_WEB_URL` | URL del front para enlaces en correos |
| `RESEND_API_KEY` / `EMAIL_FROM` | Invitaciones (ver `docs/adr/ADR-002-transactional-email-provider.md`) |

Token de Supabase CLI (una vez): copiar `.supabase/access-token.example` → `.supabase/access-token` con un token `sbp_...` de [Account → Access Tokens](https://supabase.com/dashboard/account/tokens). Está en `.gitignore`.

### 3. Base de datos (migraciones)

Enlaza el proyecto remoto y aplica migraciones pendientes:

```bash
npm run supabase:login    # o: bash scripts/supabase-login.sh
npm run dev:setup         # login + link + sync .env (sin levantar servidores)
# Si el link falló manualmente:
# supabase link --project-ref <ref-desde-dashboard>
supabase db push
```

Comprueba estado:

```bash
supabase migration list
```

### 4. Sincronizar variables a las apps

```bash
npm run env:sync
```

Genera `apps/api/.env` y `apps/web/.env` desde la raíz. Edita siempre `.env` en la raíz y vuelve a ejecutar `env:sync`.

### 5. Primer administrador (opcional en DB vacía)

Ver sección [Bootstrap seguro del primer Administrador](#bootstrap-seguro-del-primer-administrador-us-001).

### 6. Arrancar la aplicación

**Opción A — todo en uno (recomendado):**

```bash
npm run dev
```

Hace login Supabase (si aplica), `env:sync`, link y levanta API (`3001`) + web (Vite, `5173` o `5174`).

**Opción B — terminales separadas:**

```bash
npm run env:sync
npm run dev:api    # http://localhost:3001
npm run dev:web    # http://localhost:5173
```

**Opción C — solo preparar entorno:**

```bash
npm run dev:setup
```

### 7. Worker Python (opcional, paso CAD real)

El pipeline puede correr sin worker (stubs). Para inspección DWG con ezdxf:

```bash
cd services/cad-worker
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
python -m cad_worker health
python -m cad_worker inspect --input /ruta/a/archivo.dxf --json
```

En la API puedes fijar `CAD_WORKER_PYTHON` a la ruta del intérprete del venv (`.../cad-worker/.venv/bin/python3`).

### 8. URLs y flujo de prueba

| Servicio | URL / comando |
|----------|----------------|
| Web | http://localhost:5173 (o el puerto que indique Vite) |
| API health | http://localhost:3001/healthz |
| Subir DWG | Tras login como arquitecto → trabajos → subir `.dwg` |

Con `PIPELINE_WORKER_ENABLED` activo (por defecto fuera de tests), al registrar el archivo el job pasa a `procesando` sin pulsar «Procesar». El botón «Procesar» usa `?sync=1` para esperar el resultado en la misma petición.

### 9. Verificación local (equivalente a CI)

```bash
npm run lint
npm run typecheck
npm run test
npm run build
./scripts/run-golden-pipeline.sh
```

## Salud (healthchecks)

- Web: `GET http://localhost:5173/healthz`
- API: `GET http://localhost:3001/healthz`
- Worker: `python -m cad_worker health` (exit code 0)

## CI/CD

El repositorio ejecuta **GitHub Actions** en cada `pull_request` y en pushes a `main` (workflow `.github/workflows/ci.yml`):

- **apps/web** y **apps/api**: en matriz **Node.js 20 y 22**, `npm ci`, luego `lint`, `typecheck`, `test` y `build` por workspace.
- **services/cad-worker**: Python **3.12**, `pip install -e ".[dev]"`, `ruff check`, `pytest`, y comprobación CLI `python -m cad_worker health`.

La verificación local equivalente:

```bash
npm ci
npm run lint
npm run typecheck
npm run test
npm run build
cd services/cad-worker && pip install -e ".[dev]" && ruff check src tests && pytest && python -m cad_worker health
```

**Artefactos de build:** no se publican todavía desde CI; puede añadirse un upload cuando haya un flujo de release.

## Despliegue en Vercel

Arquitectura objetivo en producción:

| Componente | Dónde | Notas |
|------------|-------|--------|
| **Web** (`apps/web`) | Vercel | SPA estática (Vite). Ya enlazado al repo: [colocador-planos-electricos.vercel.app](https://colocador-planos-electricos.vercel.app) |
| **API** (`apps/api`) | Vercel (2.º proyecto) o Render/Fly | Express + worker de pipeline en proceso. Ver limitaciones abajo |
| **Supabase** | Supabase Cloud | Auth, Postgres, Storage |
| **cad-worker** | No en Vercel | Python + ezdxf; host con contenedor/VM o desactivar con `CAD_WORKER_DISABLED=true` en API serverless |

### Prerrequisitos

- Cuenta [Vercel](https://vercel.com) con acceso al repositorio de GitHub.
- Proyecto Supabase en producción con migraciones aplicadas (`supabase db push` desde tu máquina).
- [Vercel CLI](https://vercel.com/docs/cli) (opcional): `npm i -g vercel`.

### A. Frontend (proyecto Vercel «web»)

En [Vercel Dashboard](https://vercel.com) → proyecto del repo → **Settings → General**:

| Ajuste | Valor |
|--------|--------|
| Root Directory | `apps/web` |
| Framework Preset | Vite |
| Build Command | `npm run build` (se ejecuta dentro de `apps/web`; si falla por workspaces, usa Install en raíz — ver nota) |
| Output Directory | `dist` |
| Install Command | `cd ../.. && npm ci` *(monorepo: instalar desde la raíz)* |

Si el preset no detecta el monorepo, crea el proyecto con **Root Directory** vacío y override:

- **Install Command:** `npm ci`
- **Build Command:** `npm run build --workspace=web`
- **Output Directory:** `apps/web/dist`

**Environment Variables** (Production y Preview):

| Variable | Ejemplo / notas |
|----------|-----------------|
| `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Anon key del proyecto |
| `VITE_API_URL` | URL pública de la API desplegada (sin barra final) |

Tras el primer deploy, en **Supabase → Authentication → URL configuration** añade la URL de Vercel (producción y preview) como redirect / site URL según uses magic links o recovery.

**CLI (preview):**

```bash
cd apps/web
vercel link          # elegir el proyecto web
vercel env pull .env.local
vercel               # preview
vercel --prod        # producción
```

### B. API (segundo proyecto Vercel o host Node)

La API es un servidor Express que arranca un **worker en background** (`PIPELINE_WORKER_ENABLED`) para procesar la cola del pipeline. En **serverless puro** ese worker no es fiable (el proceso puede congelarse entre invocaciones).

Opciones:

1. **Recomendado para MVP completo:** desplegar `apps/api` en [Render](https://render.com), [Fly.io](https://fly.io) o Railway como **Web Service** (proceso siempre activo), con `npm run build && npm start`.
2. **Vercel:** segundo proyecto apuntando al mismo repo, con **Fluid Compute** / runtime Node y tiempo de ejecución ampliado, o desactivar el worker en servidor (`PIPELINE_WORKER_DISABLED=true`) y encolar solo vía endpoints (limitado).

Si usas **segundo proyecto en Vercel** (Root Directory `apps/api`):

| Ajuste | Valor |
|--------|--------|
| Install Command | `cd ../.. && npm ci` |
| Build Command | `npm run build --workspace=api` |
| Output Directory | `apps/api/dist` *(si usas build estático; para Express suele usarse un entry serverless — ver nota)* |

Para Express en Vercel hoy el equipo suele usar un **host Node de larga duración** hasta adaptar un entry `@vercel/node`. Mientras tanto, en Render/Fly:

```bash
# Build
npm ci
npm run build --workspace=api

# Start (en el host)
cd apps/api && node dist/index.js
```

**Variables de entorno (API — Production):**

| Variable | Obligatoria | Notas |
|----------|-------------|--------|
| `SUPABASE_URL` | Sí | |
| `SUPABASE_ANON_KEY` | Sí | |
| `SUPABASE_SERVICE_ROLE_KEY` | Sí | Server only |
| `CORS_ORIGIN` | Sí | URL del front en Vercel (coma si hay preview + prod) |
| `PUBLIC_WEB_URL` | Sí | Misma URL pública del front |
| `RESEND_API_KEY` | Sí* | *Si usas invitaciones por email |
| `EMAIL_FROM` | Sí* | Dominio verificado en Resend |
| `BOOTSTRAP_ADMIN_EMAIL` | Setup | Solo para `npm run bootstrap:admin` (ejecutar en CI o local, no en runtime) |
| `SIGNED_URL_TTL_SECONDS` | No | Default `3600` |
| `PIPELINE_WORKER_ENABLED` | No | `true` en host Node; `false` en serverless experimental |
| `CAD_WORKER_DISABLED` | No | `true` si no hay Python/ezdxf en el host de la API |

Tras desplegar la API, actualiza en el proyecto **web** de Vercel:

- `VITE_API_URL` = URL pública de la API (p. ej. `https://cambre-api.onrender.com` o la URL del 2.º proyecto Vercel).

Vuelve a desplegar el front para que el build incorpore la variable.

### C. Supabase (producción)

Desde tu máquina, con el proyecto enlazado:

```bash
supabase db push
npm --workspace api run bootstrap:admin   # solo si aún no hay admin
```

Configura en Supabase Dashboard:

- **Storage:** buckets `job-dwg-input` y `job-dwg-output` (migración T-05).
- **Auth:** Site URL y redirects con la URL de Vercel.
- **SMTP / Auth templates** si usas invitaciones y recovery.

### D. cad-worker (fuera de Vercel)

No desplegar `services/cad-worker` en Vercel (binarios ezdxf, timeouts). Alternativas:

- Contenedor en el mismo host que la API, con `CAD_WORKER_PYTHON` apuntando al venv.
- `CAD_WORKER_DISABLED=true` en la API: el pipeline sigue con stubs; sin inspección DWG real.

### E. Checklist post-deploy

1. `GET <api>/healthz` → `200`.
2. Abrir el front en Vercel → login Supabase.
3. Como admin: invitar arquitecto (email real + Resend configurado).
4. Como arquitecto: crear trabajo, subir `.dwg`, ver estado `procesando` → `procesado`, descargar resultado.
5. Revisar logs del host de la API si el pipeline falla (`correlation_id` en respuesta de error).

Más contexto histórico en [`docs/ci.md`](docs/ci.md).

## Secretos de GitHub (Actions / despliegue)

Configura secretos en el repositorio (o entornos **staging** / **production**) con nombres acordados por entorno si aplica. Esta lista documenta variables que el MVP prevé o ya usa; valores reales solo en GitHub, no en el repo.

| Secreto sugerido | Uso |
|------------------|-----|
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | Build del front contra el proyecto Supabase del entorno. |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | API (cliente público / RLS). |
| `SUPABASE_SERVICE_ROLE_KEY` | Solo servidor (bypass RLS); **no** exponer al cliente. |
| `BOOTSTRAP_ADMIN_EMAIL` | Email del primer administrador para ejecutar `npm --workspace api run bootstrap:admin`. |
| `CORS_ORIGIN` | Orígenes permitidos para la API en ese entorno (p. ej. URL del front desplegado). |
| `VITE_API_URL` | URL base de la API consumida por el web en build. |
| `EMAIL_API_KEY` / `EMAIL_PROVIDER_*` | Envío transaccional (invitaciones, notificaciones); nombres según proveedor. |
| `OPENAI_API_KEY` u otras `*_API_KEY` | Proveedores de IA en servidor o jobs. |

**Notas**

- Los jobs actuales de lint, test y build **no dependen** de estos secretos (no hay integraciones reales en CI salvo que se añadan más adelante pruebas con mocks o bases efímeras).
- Para preview de PRs o despliegue por entorno, usa **GitHub Environments** y secretos distintos para staging vs production cuando toque cablear pipelines.

## Docker Compose (opcional)

```bash
docker compose up --build
```

