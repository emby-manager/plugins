import assert from 'node:assert/strict'
import test from 'node:test'
import type { ExternalAccountAdminAccount, PluginContext } from '@emby-manager/plugin-sdk'
import { adminActions } from './admin.ts'

function context(accountResult: unknown, auditResult: unknown): PluginContext {
  return {
    storage: { set: async () => ({ ok: true }) },
    externalAccountsAdmin: {
      getOptions: async () => ({ servers: [], adapters: [] }),
      listProviders: async () => [],
      listAccounts: async () => accountResult,
      listAudits: async () => auditResult,
    },
  } as unknown as PluginContext
}

const account = {
  id: 'account-1', externalName: 'alice', state: 'ACTIVE', createdAt: '2026-08-08T00:00:00.000Z',
  lastSyncAt: null, failureReason: null,
  provider: { id: 'provider-1', name: 'Provider', kind: 'EMBYBOSS', slug: 'provider' },
  server: { id: 'server-1', name: 'EA' }, internalUser: { id: 1, userName: 'shadow' }, embyUser: null,
} satisfies ExternalAccountAdminAccount

test('EmbyBoss admin page accepts legacy array list responses', async () => {
  const result = await adminActions['load-admin']({}, context([account], [])) as { page: { sections: Array<{ id: string; title?: string }> } }
  assert.match(result.page.sections.find((section) => section.id === 'accounts')?.title || '', /共 1 条/)
})

test('EmbyBoss admin page renders host pagination metadata and controls', async () => {
  const result = await adminActions['load-admin']({ accountPage: 2, pageSize: 25 }, context(
    { items: [account], total: 60, page: 2, pageSize: 25, totalPages: 3 },
    { items: [], total: 0, page: 1, pageSize: 25, totalPages: 0 },
  )) as { page: { sections: Array<{ id: string; title?: string; blocks: Array<{ id: string }> }> } }
  const section = result.page.sections.find((item) => item.id === 'accounts')
  assert.match(section?.title || '', /第 2\/3 页/)
  assert.deepEqual(section?.blocks.slice(1).map((block) => block.id), ['accounts-previous', 'accounts-next'])
})
