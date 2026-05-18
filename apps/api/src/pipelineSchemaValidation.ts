import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv'
import addFormats from 'ajv-formats'
import { pipelineContractsDirectory } from './pipelinePackageRoot'

function loadSchema(dir: string, file: string): object {
  return JSON.parse(readFileSync(join(dir, file), 'utf8'))
}

function formatAjvErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors?.length) return '(no details)'
  return errors.map((e) => `${e.instancePath || '/'}\t ${e.message}\t (${JSON.stringify(e.params)})`).join('; ')
}

const schemaDir = pipelineContractsDirectory()

const ajv = new Ajv({
  allErrors: true,
  strictSchema: false,
  validateSchema: false,
  validateFormats: true,
})
addFormats(ajv)

const schemaFiles = [
  'vision-layout-input.json',
  'vision-layout-output.json',
  'normative-inference-input.json',
  'normative-inference-output.json',
  'cad-generation-input.json',
]

for (const f of schemaFiles) {
  ajv.addSchema(loadSchema(schemaDir, f))
}

function requireCompiledValidator($id: string): ValidateFunction {
  const compiled = ajv.getSchema($id)
  if (!compiled) throw new Error(`Missing AJV schema for ${$id}`)
  return compiled as ValidateFunction
}

const validateVisionOutput = requireCompiledValidator('https://cambre.local/schemas/pipeline/vision-layout-output.json')
const validateNormativeOutput = requireCompiledValidator(
  'https://cambre.local/schemas/pipeline/normative-inference-output.json',
)
const validateCadGenerationInput = requireCompiledValidator(
  'https://cambre.local/schemas/pipeline/cad-generation-input.json',
)

export function assertValidVisionLayoutOutput(doc: unknown, context = 'vision-layout-output'): void {
  if (!validateVisionOutput(doc)) {
    throw new Error(`${context}: ${formatAjvErrors(validateVisionOutput.errors)}`)
  }
}

export function assertValidNormativeInferenceOutput(doc: unknown, context = 'normative-inference-output'): void {
  if (!validateNormativeOutput(doc)) {
    throw new Error(`${context}: ${formatAjvErrors(validateNormativeOutput.errors)}`)
  }
}

export function assertValidCadGenerationInput(doc: unknown, context = 'cad-generation-input'): void {
  if (!validateCadGenerationInput(doc)) {
    throw new Error(`${context}: ${formatAjvErrors(validateCadGenerationInput.errors)}`)
  }
}
