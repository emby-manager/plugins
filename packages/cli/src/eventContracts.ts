export interface PluginEventContractSpec {
  type: string
  version: string
  title: string
  description: string
  sensitivity: 'LOW' | 'MEDIUM' | 'HIGH'
  dataFields: string[]
}

export interface PluginEventContractRegistry {
  schemaVersion: number
  contracts: PluginEventContractSpec[]
}

type EventSubscriptionManifest = {
  type: string
  contractVersion?: string
  handler: string
  dataFields: string[]
}

export function assertEventContractRegistry(registry: PluginEventContractRegistry): void {
  if (registry.schemaVersion !== 1 || !Array.isArray(registry.contracts) || registry.contracts.length > 256) {
    throw new Error('plugin event contract registry is invalid')
  }
  const identities = new Set<string>()
  for (const contract of registry.contracts) {
    const identity = `${contract.type}@${contract.version}`
    if (
      !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/.test(contract.type)
      || !/^\d+\.\d+$/.test(contract.version)
      || !contract.title
      || contract.title.length > 120
      || !contract.description
      || contract.description.length > 500
      || !['LOW', 'MEDIUM', 'HIGH'].includes(contract.sensitivity)
      || !Array.isArray(contract.dataFields)
      || contract.dataFields.length > 64
      || contract.dataFields.some(field => (
        typeof field !== 'string'
        || field.length > 191
        || !/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){0,7}$/.test(field)
      ))
      || new Set(contract.dataFields).size !== contract.dataFields.length
      || identities.has(identity)
    ) {
      throw new Error(`plugin event contract registry contains an invalid or duplicate contract: ${identity}`)
    }
    identities.add(identity)
  }
}

export function assertEventSubscriptions(
  subscriptions: EventSubscriptionManifest[],
  registry: PluginEventContractRegistry,
): void {
  assertEventContractRegistry(registry)
  const declaredTypes = new Set<string>()
  for (const subscription of subscriptions) {
    if (declaredTypes.has(subscription.type)) {
      throw new Error(`event ${subscription.type} is declared more than once`)
    }
    declaredTypes.add(subscription.type)
    const version = subscription.contractVersion || '1.0'
    const knownType = registry.contracts.filter(contract => contract.type === subscription.type)
    const contract = knownType.find(candidate => candidate.version === version)
    if (!contract) {
      if (knownType.length) {
        throw new Error(`event ${subscription.type} contract version ${version} is unsupported`)
      }
      throw new Error(`event ${subscription.type} is not public`)
    }
    const publicFields = new Set(contract.dataFields)
    const denied = subscription.dataFields.filter(field => !publicFields.has(field))
    if (denied.length) {
      throw new Error(`event ${subscription.type}@${version} fields are not public: ${denied.join(', ')}`)
    }
  }
}
