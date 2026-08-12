export interface ProviderProtocolSpec {
  id: string
  version: string
  kind: string
  operations: Array<{
    name: string
    executionMode: 'READ_ONLY' | 'SUPERVISED_WRITE'
    inputSchema: Record<string, unknown>
    outputSchema: Record<string, unknown>
  }>
}

type ProviderManifest = {
  id: string
  kind: string
  protocol?: { id: string; version: string }
  operations: Array<{
    name: string
    executionMode?: 'READ_ONLY' | 'SUPERVISED_WRITE'
    inputSchema: Record<string, unknown>
    outputSchema: Record<string, unknown>
  }>
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

/**
 * Validates only protocol identity and wire compatibility. Permission grants,
 * publisher trust and write approval remain runtime host decisions.
 */
export function assertProviderProtocol(
  provider: ProviderManifest,
  specs: readonly ProviderProtocolSpec[],
): { conformance: 'CUSTOM_UNVERIFIED' | 'DECLARED_UNVERIFIED' | 'VERIFIED'; protocol: string | null } {
  if (!provider.protocol) return { conformance: 'CUSTOM_UNVERIFIED', protocol: null }
  const protocolRef = `${provider.protocol.id}@${provider.protocol.version}`
  const matchingId = specs.filter(spec => spec.id === provider.protocol?.id)
  const spec = matchingId.find(candidate => candidate.version === provider.protocol?.version)
  if (!spec) {
    if (provider.protocol.id.startsWith('emby-manager.')) {
      const supported = matchingId.map(candidate => candidate.version).sort().join(', ') || 'none'
      throw new Error(`provider ${provider.id} uses unsupported reserved protocol ${protocolRef}; supported versions: ${supported}`)
    }
    if (provider.operations.some(operation => !operation.executionMode)) {
      throw new Error(`provider ${provider.id} declares protocol ${protocolRef} but an operation has no executionMode`)
    }
    return { conformance: 'DECLARED_UNVERIFIED', protocol: protocolRef }
  }
  if (provider.kind !== spec.kind) {
    throw new Error(`provider ${provider.id} protocol ${protocolRef} requires kind ${spec.kind}`)
  }
  const operations = new Map(provider.operations.map(operation => [operation.name, operation]))
  for (const expected of spec.operations) {
    const actual = operations.get(expected.name)
    if (!actual) throw new Error(`provider ${provider.id} protocol ${protocolRef} is missing operation ${expected.name}`)
    if (actual.executionMode !== expected.executionMode) {
      throw new Error(`provider ${provider.id}.${expected.name} must use executionMode ${expected.executionMode}`)
    }
    if (canonicalJson(actual.inputSchema) !== canonicalJson(expected.inputSchema)) {
      throw new Error(`provider ${provider.id}.${expected.name} inputSchema does not match ${protocolRef}`)
    }
    if (canonicalJson(actual.outputSchema) !== canonicalJson(expected.outputSchema)) {
      throw new Error(`provider ${provider.id}.${expected.name} outputSchema does not match ${protocolRef}`)
    }
  }
  return { conformance: 'VERIFIED', protocol: protocolRef }
}
