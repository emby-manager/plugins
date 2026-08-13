export type CatalogWorkflowTemplateSummary = {
  id: string
  version: string
  title: string
  description: string
  stepCount: number
  readOnlySteps: number
  supervisedWriteSteps: number
  requiredCapabilities: string[]
  highestResourceImportance?: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL'
  containsIrreversibleWrite: boolean
  largestStepAffectedResources: number
  largestStepEstimatedCostMinor: number
}

const importance = ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Enforce invariants which JSON Schema cannot express. The official release
 * action calls this before signing a catalog, so a hand-edited discovery
 * summary cannot claim a lower risk than the shape it publishes.
 */
export function assertCatalogWorkflowTemplateSummaries(catalog: unknown): void {
  if (!isRecord(catalog) || !Array.isArray(catalog.plugins)) {
    throw new Error('catalog workflow template summaries require a catalog object')
  }
  for (const pluginValue of catalog.plugins) {
    if (!isRecord(pluginValue) || typeof pluginValue.id !== 'string' || !Array.isArray(pluginValue.versions)) {
      throw new Error('catalog plugin entry is invalid')
    }
    for (const versionValue of pluginValue.versions) {
      if (!isRecord(versionValue)) throw new Error(`catalog plugin ${pluginValue.id} has an invalid version`)
      if (versionValue.workflowTemplates === undefined) continue
      if (!Array.isArray(versionValue.workflowTemplates)) {
        throw new Error(`catalog plugin ${pluginValue.id} workflowTemplates must be an array`)
      }
      const identities = new Set<string>()
      for (const summaryValue of versionValue.workflowTemplates) {
        if (!isRecord(summaryValue)) throw new Error(`catalog plugin ${pluginValue.id} has an invalid workflow summary`)
        const identity = `${String(summaryValue.id)}@${String(summaryValue.version)}`
        if (identities.has(identity)) throw new Error(`catalog plugin ${pluginValue.id} repeats workflow template ${identity}`)
        identities.add(identity)

        const stepCount = Number(summaryValue.stepCount)
        const readOnlySteps = Number(summaryValue.readOnlySteps)
        const supervisedWriteSteps = Number(summaryValue.supervisedWriteSteps)
        if (readOnlySteps + supervisedWriteSteps !== stepCount) {
          throw new Error(`catalog workflow template ${identity} step totals do not match`)
        }
        const capabilities = summaryValue.requiredCapabilities
        if (!Array.isArray(capabilities) || capabilities.some(capability => typeof capability !== 'string')) {
          throw new Error(`catalog workflow template ${identity} capabilities are invalid`)
        }
        if (capabilities.some((capability, index) => index > 0 && String(capabilities[index - 1]).localeCompare(capability) >= 0)) {
          throw new Error(`catalog workflow template ${identity} capabilities must be unique and sorted`)
        }

        const highestImportance = summaryValue.highestResourceImportance
        const irreversible = summaryValue.containsIrreversibleWrite
        const largestAffected = Number(summaryValue.largestStepAffectedResources)
        const largestCost = Number(summaryValue.largestStepEstimatedCostMinor)
        if (supervisedWriteSteps === 0) {
          if (highestImportance !== undefined || irreversible !== false || largestAffected !== 0 || largestCost !== 0) {
            throw new Error(`read-only catalog workflow template ${identity} cannot publish write risk`)
          }
        } else if (!importance.includes(highestImportance as (typeof importance)[number]) || largestAffected < 1) {
          throw new Error(`catalog workflow template ${identity} must publish bounded write risk`)
        }
      }
    }
  }
}

/**
 * Produce discovery-only metadata from the already verified package manifest.
 * This summary is signed as part of the official catalog, but it never becomes
 * an execution contract: EM re-reads the installed package manifest at runtime.
 */
export function summarizeWorkflowTemplates(manifest: Record<string, any>): CatalogWorkflowTemplateSummary[] {
  const activities = new Map<string, Record<string, any>>(
    (manifest.workflowActivities || []).map((activity: Record<string, any>) => [activity.name, activity]),
  )
  const templates = (manifest.workflowTemplates || []) as Array<Record<string, any>>
  return templates.map((template) => {
    const steps = template.steps as Array<Record<string, any>>
    const resolved: Array<Record<string, any>> = steps.map((step) => {
      const activity = activities.get(step.activity)
      if (!activity) throw new Error(`workflow template ${template.id} references unknown activity ${step.activity}`)
      return activity
    })
    const writes: Array<Record<string, any>> = resolved.filter(activity => activity.executionMode === 'SUPERVISED_WRITE')
    const requiredCapabilities = [...new Set(resolved.flatMap(activity => activity.requiredCapabilities || []))].sort()
    const highestResourceImportance = writes.reduce<(typeof importance)[number] | undefined>((highest, activity) => {
      const current = activity.risk?.resourceImportance as (typeof importance)[number] | undefined
      if (!current) return highest
      return !highest || importance.indexOf(current) > importance.indexOf(highest) ? current : highest
    }, undefined)
    return {
      id: template.id,
      version: template.version,
      title: template.title,
      description: template.description,
      stepCount: resolved.length,
      readOnlySteps: resolved.length - writes.length,
      supervisedWriteSteps: writes.length,
      requiredCapabilities,
      ...(highestResourceImportance ? { highestResourceImportance } : {}),
      containsIrreversibleWrite: writes.some(activity => activity.risk?.reversible === false),
      largestStepAffectedResources: writes.reduce(
        (maximum, activity) => Math.max(maximum, Number(activity.risk?.maximumAffectedResources || 0)),
        0,
      ),
      largestStepEstimatedCostMinor: writes.reduce(
        (maximum, activity) => Math.max(maximum, Number(activity.risk?.estimatedCostMinor || 0)),
        0,
      ),
    }
  })
}
