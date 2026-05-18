---
name: user-stories-technical-doc
description: >-
  Conduce una conversación iterativa a partir de una instrucción breve para
  reunir los datos necesarios y producir documentación markdown de historias de
  usuario con contenido técnico apto para alimentar sistemas downstream (planificación,
  desarrollo, trazabilidad). Persiste los entregables en docs/, usando uno o más
  archivos según alcance. Use cuando el usuario pida definir historias de usuario,
  backlog técnico, especificación desde una idea simple, o documentación HU para el equipo/sistema.
disable-model-invocation: true
---

# Historias de usuario (documento técnico)

Vamos a crear un skill que defina User stories. Este skill puede recibir una instruccion simple, y el objetivo es iterar conmigo para obtener todos los detalles necesarios para luego poder armar un documento de historias de usuario tecnico, que sirva en un futuro para alimentar nuestro sistema. El documento de historias de usuario se guarda dentro de docs. Podes crear varios documentos si lo consideras necesario.

## Objetivo operativo

Partir de una **instrucción simple** del usuario, **iterar** hasta tener suficiente detalle y escribir en **`docs/`** uno o más documentos markdown de **historias de usuario técnicas** que sirvan después como fuente para otro sistema o proceso.

## Principios

1. **No inventar silenciosamente**: si falta algo necesario para el documento final o para ingestión futura, preguntarlo explícitamente.
2. **Brevedad en el chat**: pocas preguntas por turno (prioriza gaps bloqueantes).
3. **Escribir en disco solo cuando haya consenso** sobre alcance y estructura de archivo(s); antes puede sintetizar borrador en el mensaje.
4. **Misma nomenclatura** en todos los archivos: términos de dominio acordados con el usuario.

## Workflow

### Fase 1 — Captura inicial

- Reformula la petición en 2–4 líneas y confirma el **objetivo de negocio** implícito.
- Si hay ambigüedad en alcance (qué entra / qué no), aclara antes de profundizar.

### Fase 2 — Descubrimiento iterativo

Para cada ciclo:

1. Resume lo ya acordado.
2. Lista **solo huecos** (preguntas concretas), agrupadas si hay muchas.
3. Cuando el usuario responda, integra respuestas y repite hasta cubrir la checklist mínima (abajo).

**Checklist mínima** antes del documento final:

- Actores / roles y permisos (si aplica)
- Alcance funcional y **fuera de alcance**
- Flujo feliz + principales variaciones / errores
- **Datos**: entidades, campos relevantes, reglas de validación
- Integraciones (APIs, eventos, colas, terceros) y contratos si los conocen
- Reglas de negocio explícitas y prioridad relativa si hay conflicto
- **No funcionales** relevantes (performance, seguridad, auditoría, accesibilidad, idiomas)
- Criterios de aceptación **verificables**
- Dependencias, supuestos, riesgos
- Metadatos para ingestión (IDs establecidos por convención, etiquetas, módulo, epic relacionado — preguntar qué espera el “sistema” futuro si no está definido)

### Fase 3 — Diseño del entregable en `docs/`

Decidir uno vs varios archivos:

| Situación | Recomendación |
|-----------|----------------|
| Una capacidad cohesiva, pocas HUs | Un solo `.md` en `docs/` |
| Epic grande o equipos/módulos distintos | `docs/user-stories/<slug>/README.md` + `HU-xxx-<slug>.md` por historia |
| Dominios muy separados | Un archivo por dominio bajo `docs/user-stories/` |

Convenciones de nombre:

- Slug en kebab-case: `planos-de-luz-exportacion`.
- IDs de historia si los usa el proceso: `HU-001`, `US-012`, etc. (preguntar o proponer y confirmar).

Crear **`docs/`** si no existe. Rutas relativas al **root del repositorio** donde corre la sesión.

### Fase 4 — Escritura y cierre

- Generar el(los) markdown siguiendo la plantilla de [reference.md](reference.md).
- Incluir al inicio de cada archivo (cuando aplique): **Versión**, **Fecha**, **Autoría**, **Estado** (borrador / revisión / listo).
- Cierre del turno: lista rutas creadas/actualizadas y preguntas abiertas (si quedan).

## Cuándo no sobrescribir

Si ya existe un documento en `docs/` sobre el mismo tema:

1. Leer el archivo actual.
2. Proponer **merge** explícito o nuevo archivo con sufijo (`-v2`, fecha).
3. No pisar contenido sin confirmación del usuario.

## Recursos

- Plantilla por historia, ejemplo y checklist extendido: [reference.md](reference.md)
