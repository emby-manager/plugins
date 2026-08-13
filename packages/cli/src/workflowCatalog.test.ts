import assert from 'node:assert/strict'
import test from 'node:test'
import { assertCatalogWorkflowTemplateSummaries, summarizeWorkflowTemplates } from './workflowCatalog.ts'

test('official catalog workflow summaries are derived from the verified manifest', () => {
  const summaries = summarizeWorkflowTemplates({
    workflowActivities: [
      {
        name: 'inspect', executionMode: 'READ_ONLY', requiredCapabilities: ['emby.library.read'],
      },
      {
        name: 'notify', executionMode: 'SUPERVISED_WRITE',
        requiredCapabilities: ['notification.any.send', 'emby.library.read'],
        risk: { resourceImportance: 'HIGH', reversible: false, maximumAffectedResources: 25, estimatedCostMinor: 300 },
      },
    ],
    workflowTemplates: [{
      id: 'inspect-and-notify', version: '1.0', title: '检查并通知', description: '先检查再通知。',
      steps: [{ key: 'inspect', activity: 'inspect' }, { key: 'notify', activity: 'notify', inputFrom: 'inspect' }],
    }],
  })
  assert.deepEqual(summaries, [{
    id: 'inspect-and-notify', version: '1.0', title: '检查并通知', description: '先检查再通知。',
    stepCount: 2,
    readOnlySteps: 1,
    supervisedWriteSteps: 1,
    requiredCapabilities: ['emby.library.read', 'notification.any.send'],
    highestResourceImportance: 'HIGH',
    containsIrreversibleWrite: true,
    largestStepAffectedResources: 25,
    largestStepEstimatedCostMinor: 300,
  }])
})

test('read-only templates do not invent write risk', () => {
  const [summary] = summarizeWorkflowTemplates({
    workflowActivities: [{ name: 'inspect', requiredCapabilities: [] }],
    workflowTemplates: [{
      id: 'inspect', version: '1.0', title: '检查', description: '只读检查。',
      steps: [{ key: 'inspect', activity: 'inspect' }],
    }],
  })
  assert.equal(summary?.supervisedWriteSteps, 0)
  assert.equal(summary?.readOnlySteps, 1)
  assert.equal(summary?.containsIrreversibleWrite, false)
  assert.equal(summary?.highestResourceImportance, undefined)
  assert.equal(summary?.largestStepAffectedResources, 0)
  assert.equal(summary?.largestStepEstimatedCostMinor, 0)
})

test('catalog generation fails closed when a template activity is missing', () => {
  assert.throws(() => summarizeWorkflowTemplates({
    workflowActivities: [],
    workflowTemplates: [{
      id: 'broken', version: '1.0', title: '错误', description: '错误模板。',
      steps: [{ key: 'missing', activity: 'missing' }],
    }],
  }), /references unknown activity/)
})

test('catalog validation accepts legacy versions and valid derived summaries', () => {
  assert.doesNotThrow(() => assertCatalogWorkflowTemplateSummaries({
    plugins: [{
      id: 'dev.emby-manager.example',
      versions: [
        { version: '1.0.0' },
        {
          version: '1.1.0',
          workflowTemplates: [{
            id: 'inspect', version: '1.0', title: '检查', description: '检查内容。',
            stepCount: 2, readOnlySteps: 1, supervisedWriteSteps: 1,
            requiredCapabilities: ['emby.library.read', 'notification.any.send'],
            highestResourceImportance: 'NORMAL', containsIrreversibleWrite: false,
            largestStepAffectedResources: 1, largestStepEstimatedCostMinor: 0,
          }],
        },
      ],
    }],
  }))
})

test('catalog validation rejects understated or ambiguous workflow risk', () => {
  const catalog = (summary: Record<string, unknown>) => ({
    plugins: [{ id: 'dev.emby-manager.example', versions: [{ version: '1.0.0', workflowTemplates: [summary] }] }],
  })
  const valid = {
    id: 'inspect', version: '1.0', title: '检查', description: '检查内容。',
    stepCount: 2, readOnlySteps: 1, supervisedWriteSteps: 1,
    requiredCapabilities: ['emby.library.read'], highestResourceImportance: 'HIGH',
    containsIrreversibleWrite: false, largestStepAffectedResources: 3, largestStepEstimatedCostMinor: 0,
  }
  assert.throws(
    () => assertCatalogWorkflowTemplateSummaries(catalog({ ...valid, readOnlySteps: 2 })),
    /step totals do not match/,
  )
  assert.throws(
    () => assertCatalogWorkflowTemplateSummaries(catalog({ ...valid, highestResourceImportance: undefined })),
    /must publish bounded write risk/,
  )
  assert.throws(
    () => assertCatalogWorkflowTemplateSummaries(catalog({
      ...valid,
      requiredCapabilities: ['notification.any.send', 'emby.library.read'],
    })),
    /unique and sorted/,
  )
})
