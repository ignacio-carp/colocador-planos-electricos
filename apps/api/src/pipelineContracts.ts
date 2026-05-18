/**
 * Pipeline payload contract version (ADR-003). Bump semver when schemas in
 * docs/contracts/pipeline/ change incompatibly.
 */
export const PIPELINE_CONTRACT_VERSION = '1.0.0' as const

export type PipelineContractVersion = typeof PIPELINE_CONTRACT_VERSION
