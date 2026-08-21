import assert from 'node:assert/strict'
import test from 'node:test'
import type { PluginContext } from '@emby-manager/plugin-sdk'
import {
  ISOLATED_CONFIRMATION,
  runDownloadProviderConformance,
  type DownloadProviderOperation,
} from '../../../packages/provider-conformance/src/index.ts'
import plugin from './server.ts'

test('download provider template passes the isolated semantic conformance matrix', async () => {
  const jobs = new Map<string, { ref: string; state: string }>()
  let sequence = 0
  const context = {
    config: { baseUrl: 'https://provider.example.com' },
    secrets: {
      fetch: async (request: { url: string; method: string; body?: unknown }) => {
        const url = new URL(request.url)
        let result: { providerJobRef: string | null; state: string; observedAt: string }
        if (request.method === 'POST' && url.pathname === '/jobs') {
          const input = request.body as { commandId: string }
          let job = jobs.get(input.commandId)
          if (!job) {
            sequence += 1
            job = { ref: `fixture-job-${sequence}`, state: 'ACCEPTED' }
            jobs.set(input.commandId, job)
          }
          result = { providerJobRef: job.ref, state: 'ACCEPTED', observedAt: new Date().toISOString() }
        } else if (request.method === 'POST' && url.pathname.endsWith('/cancel')) {
          const input = request.body as { commandId: string; providerJobRef: string }
          const submitCommandId = input.commandId.replace('conformance-cancel-', 'conformance-submit-')
          const job = jobs.get(submitCommandId)
          assert.equal(job?.ref, input.providerJobRef)
          job!.state = 'CANCELLED'
          result = { providerJobRef: job!.ref, state: 'CANCELLED', observedAt: new Date().toISOString() }
        } else {
          const commandMatch = url.pathname.match(/^\/jobs\/by-command\/(.+)$/)
          const refMatch = url.pathname.match(/^\/jobs\/(.+)$/)
          const job = commandMatch
            ? jobs.get(decodeURIComponent(commandMatch[1]))
            : [...jobs.values()].find(item => item.ref === decodeURIComponent(refMatch?.[1] || ''))
          result = job
            ? { providerJobRef: job.ref, state: job.state, observedAt: new Date().toISOString() }
            : { providerJobRef: null, state: 'UNKNOWN', observedAt: new Date().toISOString() }
        }
        return { ok: true, status: 200, body: JSON.stringify(result) }
      },
    },
  } as unknown as PluginContext
  const operations = plugin.providers?.download.operations
  assert.ok(operations)

  const report = await runDownloadProviderConformance({
    authorization: {
      isolatedSandbox: true,
      writesAndCancellationApproved: true,
      confirmation: ISOLATED_CONFIRMATION,
    },
    invoke: async (operation: DownloadProviderOperation, input) => {
      return await operations[operation](input, context)
    },
    reconciliationIntervalMs: 0,
  })

  assert.equal(report.status, 'PASSED')
  assert.equal(sequence, 1)
})
