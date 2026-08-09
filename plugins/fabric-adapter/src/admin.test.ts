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
  provider: { id: 'provider-1', name: 'Provider', kind: 'FABRIC', slug: 'provider' },
  server: { id: 'server-1', name: 'EA' }, internalUser: { id: 1, userName: 'shadow' }, embyUser: null,
} satisfies ExternalAccountAdminAccount

test('Fabric admin page accepts legacy arrays and paged list responses', async () => {
  const legacy = await adminActions['load-admin']({}, context([account], [])) as { page: { sections: Array<{ id: string; title?: string }> } }
  assert.match(legacy.page.sections.find((section) => section.id === 'accounts')?.title || '', /共 1 条/)

  const paged = await adminActions['load-admin']({ auditPage: 2 }, context(
    { items: [], total: 0, page: 1, pageSize: 25, totalPages: 0 },
    { items: [], total: 30, page: 2, pageSize: 25, totalPages: 2 },
  )) as { page: { sections: Array<{ id: string; title?: string; blocks: Array<{ id: string }> }> } }
  const section = paged.page.sections.find((item) => item.id === 'audits')
  assert.match(section?.title || '', /第 2\/2 页/)
  assert.deepEqual(section?.blocks.slice(1).map((block) => block.id), ['audits-previous'])
})
