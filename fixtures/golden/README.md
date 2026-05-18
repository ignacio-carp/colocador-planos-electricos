# Golden fixtures — pipeline regression (S-04)

## Contenido

- `pipeline-stub-normative.snapshot.json` — salida esperada del stub US-008 para un `job_id` fijo (determinista).
- Los DWG reales de Cambre se incorporarán cuando negocio entregue planos acordados.

## Checklist obtención planos reales

- [ ] Acordar con Cambre 2–3 DWG representativos (escala, habitaciones, capas).
- [ ] Subir a `fixtures/golden/dwg/` (sin datos personales).
- [ ] Actualizar snapshots tras cambios de contrato en `docs/contracts/pipeline/`.

## Ejecución local

```bash
./scripts/run-golden-pipeline.sh
```

O vía monorepo:

```bash
npm test --workspace=api -- --test-name-pattern=golden
```
