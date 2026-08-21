import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ISOLATED_CONFIRMATION,
  runDownloadProviderConformance,
  type DownloadProviderOperation,
} from './index.ts'

function memoryProvider(options: { duplicateCreatesNewJob?: boolean; unknownByCommand?: boolean } = {}) {
  let sequence = 0
  const commands = new Map<string, { ref: string; state: string }>()
  const invoke = async (operation: DownloadProviderOperation, input: Readonly<Record<string, unknown>>) => {
    const now = new Date().toISOString()
    if (operation === 'submit') {
      const commandId = String(input.commandId)
      let job = commands.get(commandId)
      if (!job || options.duplicateCreatesNewJob) {
        sequence += 1
        job = { ref: `job-${sequence}`, state: 'ACCEPTED' }
        commands.set(commandId, job)
      }
      return { providerJobRef: job.ref, state: 'ACCEPTED', observedAt: now }
    }
    const commandId = operation === 'status' ? String(input.commandId) : `conformance-submit-${String(input.commandId).replace('conformance-cancel-', '')}`
    const job = commands.get(commandId)
    if (!job || (operation === 'status' && options.unknownByCommand && !input.providerJobRef)) {
      return { providerJobRef: null, state: 'UNKNOWN', observedAt: now }
    }
    if (operation === 'cancel') job.state = 'CANCELLED'
    return {
      providerJobRef: job.ref,
      state: operation === 'cancel' ? 'CANCELLED' : job.state,
      observedAt: now,
    }
  }
  return invoke
}

const authorization = {
  isolatedSandbox: true,
  writesAndCancellationApproved: true,
  confirmation: ISOLATED_CONFIRMATION,
} as const

test('download conformance proves recovery, idempotency, monotonic reads and cancellation', async () => {
  const report = await runDownloadProviderConformance({
    authorization,
    invoke: memoryProvider(),
    reconciliationIntervalMs: 0,
  })
  assert.equal(report.status, 'PASSED')
  assert.equal(report.cases.length, 5)
  assert.ok(report.cases.every(item => item.status === 'PASSED'))
  assert.equal(report.safety.containsSensitiveProviderData, false)
  assert.equal(JSON.stringify(report).includes('job-1'), false)
})

test('download conformance fails providers that cannot recover from command ID alone', async () => {
  const report = await runDownloadProviderConformance({
    authorization,
    invoke: memoryProvider({ unknownByCommand: true }),
    reconciliationAttempts: 2,
    reconciliationIntervalMs: 0,
  })
  assert.equal(report.status, 'FAILED')
  assert.equal(report.cases[0].code, 'COMMAND_ID_RECONCILIATION_FAILED')
  assert.ok(report.cases.slice(1).every(item => item.status === 'SKIPPED'))
})

test('download conformance catches duplicate submit creating another external job', async () => {
  const operations: DownloadProviderOperation[] = []
  const provider = memoryProvider({ duplicateCreatesNewJob: true })
  const report = await runDownloadProviderConformance({
    authorization,
    invoke: async (operation, input) => {
      operations.push(operation)
      return provider(operation, input)
    },
    reconciliationIntervalMs: 0,
  })
  assert.equal(report.status, 'FAILED')
  assert.equal(report.cases.find(item => item.id === 'duplicate-submit-idempotency')?.code, 'DUPLICATE_SUBMIT_CREATED_DIFFERENT_JOB')
  assert.equal(operations.includes('cancel'), false)
  assert.ok(report.cases.slice(2).every(item => item.status === 'SKIPPED'))
})

test('download conformance refuses to write without the exact isolated-sandbox confirmation', async () => {
  let calls = 0
  await assert.rejects(
    runDownloadProviderConformance({
      authorization: { ...authorization, confirmation: 'yes' },
      invoke: async () => { calls += 1; return {} },
    }),
    /ISOLATED_SANDBOX_CONFIRMATION_REQUIRED/,
  )
  assert.equal(calls, 0)
})

test('download conformance aborts a timed-out write and never starts another operation', async () => {
  const operations: DownloadProviderOperation[] = []
  const report = await runDownloadProviderConformance({
    authorization,
    timeoutMs: 250,
    invoke: async (operation, _input, { signal }) => {
      operations.push(operation)
      return await new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(new Error('secret-provider-error')), { once: true })
      })
    },
  })
  assert.deepEqual(operations, ['submit'])
  assert.equal(report.cases[0].code, 'INVOCATION_TIMEOUT')
  assert.ok(report.cases.slice(1).every(item => item.status === 'SKIPPED'))
  assert.equal(JSON.stringify(report).includes('secret-provider-error'), false)
})
