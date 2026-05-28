# cad-worker (MVP)

Servicio Python que centraliza la lectura e inspección de archivos CAD (DWG/DXF) para el resto de la plataforma.
Su objetivo es desacoplar la lógica CAD del API principal, de forma que el backend Node pueda delegar validaciones y extracción de metadatos en un componente especializado.

## Para qué sirve este servicio

- Inspeccionar archivos CAD y devolver un resumen estructurado.
- Estandarizar el análisis inicial de planos antes de continuar con el pipeline.
- Aislar dependencias CAD (por ejemplo `ezdxf`) en un servicio dedicado.
- Reducir complejidad en la API principal al delegar procesamiento específico.

## Flujo de llamados (alto nivel)

1. Un cliente (web, script o integración interna) sube o referencia un archivo CAD.
2. La API principal recibe la solicitud y deriva el análisis al bridge del worker.
3. El bridge (`apps/api/src/cadWorkerBridge.ts`) ejecuta el comando `inspect` del worker Python.
4. `cad-worker` analiza el archivo y responde con salida estructurada (JSON cuando corresponde).
5. La API usa ese resultado para continuar el flujo de negocio (validaciones, estado del proceso, respuesta al cliente).

### Comando principal usado por la API

```bash
python -m cad_worker inspect --input /path/to/file.dxf --json
```

El tiempo máximo de espera se controla con `CAD_WORKER_TIMEOUT_MS` (default 30s).

## Funcionamiento no técnico (referencia rápida)

Pensado como "mesa de revisión de planos":

- La API le entrega un plano al worker.
- El worker revisa el archivo y arma un reporte consistente.
- La API consume ese reporte para decidir si el archivo está apto para el siguiente paso del proceso.

Esto permite que, ante cambios en reglas CAD o librerías de parseo, el impacto quede contenido en este servicio y no en toda la plataforma.

## Ejecución local

```bash
python -m pip install -e ".[dev]"
python -m cad_worker health
python -m cad_worker inspect --input /path/to/file.dxf --json
```

## Configuración útil

- `CAD_WORKER_PYTHON`: intérprete de Python a utilizar (default `python3`).
- `CAD_WORKER_DISABLED`: desactiva la invocación desde la API (útil para pruebas o bypass controlado).
- `CAD_WORKER_FIXTURE_DWG`: ruta local a fixture CAD para pruebas de integración del pipeline.

## Dependencia CAD principal

`ezdxf` está fijado en `pyproject.toml` (`>=1.3,<2`) para asegurar compatibilidad estable en el MVP.

## Lint y formato

```bash
python -m pip install ruff black
ruff check .
black --check .
```

