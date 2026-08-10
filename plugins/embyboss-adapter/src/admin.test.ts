import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  ExternalAccountAdminAccount,
  ExternalAccountAdminAudit,
  ExternalAccountAdminProvider,
  PluginContext,
} from '@emby-manager/plugin-sdk'
import { adminActions } from './admin.ts'

const provider = {
  id: 'provider-1', name: '演示接入', slug: 'embyboss-demo', kind: 'EMBYBOSS', adapterPluginId: 'io.emby-manager.adapter.embyboss',
  adapterId: 'embyboss', routePackageId: null, enabled: true, secretPrefix: 'eb_', lastUsedAt: null,
  server: { id: 'server-1', name: '演示 EA', isActive: true },
  health: { state: 'online', checkedAt: '2000-01-01T00:00:00.000Z', latencyMs: 2, version: '4.0.0', message: null },
  routePackage: null, accountCounts: { ACTIVE: 4, PENDING: 1, FAILED: 0, DELETE_PENDING: 0 },
} satisfies ExternalAccountAdminProvider

const disabledProvider = { ...provider, enabled: false } satisfies ExternalAccountAdminProvider

const account = {
  id: 'account-1', externalName: 'alice', state: 'ACTIVE', createdAt: '2026-08-08T00:00:00.000Z',
  lastSyncAt: null, failureReason: null,
  provider: { id: 'provider-1', name: '演示接入', kind: 'EMBYBOSS', slug: 'embyboss-demo' },
  server: { id: 'server-1', name: '演示 EA' }, internalUser: { id: 1, userName: 'demo-shadow' }, embyUser: null,
} satisfies ExternalAccountAdminAccount

const audit = {
  id: 1, createdAt: '2000-01-01T00:00:00.000Z', action: 'adapter.get-user', outcome: 'success', ip: 'example-ip',
  provider: { id: 'provider-1', name: '演示接入' }, account: { id: 'account-1', externalName: 'demo-user' },
} satisfies ExternalAccountAdminAudit

const options = {
  servers: [{ id: 'server-1', name: '演示 EA', isActive: true, ready: true, routePackages: [] }],
  adapters: [{ id: 'embyboss', name: 'EmbyBoss', kind: 'EMBYBOSS', description: 'EmbyBoss 账号管理协议。', addressHint: '不要手动追加 /emby。', configHint: '将接入基地址填入 emby_url。' }],
}

interface ContextOptions {
  providers?: ExternalAccountAdminProvider[]
  accountResult?: unknown
  auditResult?: unknown
  createdSecret?: string
}

function context(config: ContextOptions = {}) {
  const calls = {
    getOptions: 0,
    listProviders: 0,
    listAccounts: [] as unknown[],
    listAudits: [] as unknown[],
    updateProvider: [] as unknown[],
    storage: [] as unknown[],
  }
  const providers = config.providers || [provider]
  const ctx = {
    storage: { set: async (_key: string, value: unknown) => { calls.storage.push(value); return { ok: true } } },
    externalAccountsAdmin: {
      getOptions: async () => { calls.getOptions += 1; return options },
      listProviders: async () => { calls.listProviders += 1; return providers },
      listAccounts: async (input: unknown) => { calls.listAccounts.push(input); return config.accountResult ?? [] },
      listAudits: async (input: unknown) => { calls.listAudits.push(input); return config.auditResult ?? [] },
      createProvider: async () => ({ provider, secret: config.createdSecret || 'secret-for-test-only' }),
      updateProvider: async (id: string, input: unknown) => { calls.updateProvider.push({ id, input }); return provider },
      rotateProviderSecret: async () => ({ provider, secret: config.createdSecret || 'rotated-secret-for-test-only' }),
      deleteProvider: async () => ({ deleted: true }),
      reconcileProvider: async () => ({ running: true, checked: 0, completed: 0, repaired: 0, failed: 0, retried: 0 }),
      reconcileAccount: async () => ({ ok: true }),
      deleteAccount: async () => ({ deleted: true }),
    },
  } as unknown as PluginContext
  return { ctx, calls }
}

function pageOf(result: unknown) {
  return (result as { page: { sections: Array<{ id: string; title?: string; blocks?: Array<Record<string, unknown>> }> } }).page
}

test('默认视图只加载接入总览，不读取账号和审计分页', async () => {
  const { ctx, calls } = context()
  const page = pageOf(await adminActions['load-admin']({}, ctx))
  const ids = page.sections.map((section) => section.id)
  assert.ok(ids.includes('overview-status'))
  assert.ok(ids.includes('providers'))
  assert.ok(!ids.includes('create-page'))
  assert.ok(!ids.includes('accounts-view'))
  assert.ok(!ids.includes('audits-view'))
  assert.equal(calls.getOptions, 0)
  assert.equal(calls.listProviders, 1)
  assert.equal(calls.listAccounts.length, 0)
  assert.equal(calls.listAudits.length, 0)
  assert.doesNotMatch(JSON.stringify(page), /删除空接入|全量对账|create-provider/)
})

test('创建视图单独显示表单，并按需读取 EA 目标配置', async () => {
  const { ctx, calls } = context()
  const page = pageOf(await adminActions['load-admin']({ view: 'create' }, ctx))
  assert.ok(page.sections.some((section) => section.id === 'create-page'))
  assert.match(JSON.stringify(page), /create-provider/)
  assert.equal(calls.getOptions, 1)
  assert.equal(calls.listProviders, 1)
  assert.equal(calls.listAccounts.length, 0)
  assert.equal(calls.listAudits.length, 0)
})

test('启用和停用只显示当前状态对应的直接动作', async () => {
  const enabledPage = pageOf(await adminActions['load-admin']({ view: 'provider', providerId: provider.id }, context().ctx))
  const enabledAction = enabledPage.sections.find((section) => section.id === 'provider-actions')?.blocks?.find((block) => block.id === 'provider-toggle')
  assert.equal(enabledAction?.title, '停用接入')
  assert.match(JSON.stringify(enabledPage), /重新生成接入密钥/)

  const disabledPage = pageOf(await adminActions['load-admin']({ view: 'provider', providerId: provider.id }, context({ providers: [disabledProvider] }).ctx))
  const disabledAction = disabledPage.sections.find((section) => section.id === 'provider-actions')?.blocks?.find((block) => block.id === 'provider-toggle')
  assert.equal(disabledAction?.title, '启用接入')
})

test('接入维护动作只出现在具体接入管理视图', async () => {
  const overview = pageOf(await adminActions['load-admin']({}, context().ctx))
  assert.doesNotMatch(JSON.stringify(overview), /检查并修复账号状态/)
  const providerPage = pageOf(await adminActions['load-admin']({ view: 'provider', providerId: provider.id }, context().ctx))
  assert.match(JSON.stringify(providerPage), /检查并修复账号状态/)
  assert.doesNotMatch(JSON.stringify(providerPage), /删除空接入/)
})

test('账号视图兼容旧版数组响应，并且不读取审计分页', async () => {
  const { ctx, calls } = context({ accountResult: [account] })
  const page = pageOf(await adminActions['load-accounts']({}, ctx))
  assert.match(page.sections.find((section) => section.id === 'accounts-view')?.title || '', /共 1 条/)
  assert.equal(calls.listAccounts.length, 1)
  assert.equal(calls.listAudits.length, 0)
  assert.equal(calls.getOptions, 0)
})

test('审计视图只读取审计分页，并保留分页视图', async () => {
  const { ctx, calls } = context({ auditResult: { items: [audit], total: 60, page: 2, pageSize: 25, totalPages: 3 } })
  const page = pageOf(await adminActions['load-audits']({ auditPage: 2, pageSize: 25 }, ctx))
  assert.match(page.sections.find((section) => section.id === 'audits-view')?.title || '', /第 2\/3 页/)
  assert.equal(calls.listAudits.length, 1)
  assert.equal(calls.listAccounts.length, 0)
  const next = page.sections.find((section) => section.id === 'audits-view')?.blocks?.find((block) => block.id === 'audits-next')
  assert.equal(next?.action, 'load-audits')
  assert.equal((next?.input as Record<string, unknown>)?.view, 'audits')
})

test('账号分页动作保留当前视图和筛选条件', async () => {
  const { ctx } = context({ accountResult: { items: [account], total: 60, page: 2, pageSize: 25, totalPages: 3 } })
  const page = pageOf(await adminActions['load-accounts']({ accountPage: 2, providerId: provider.id, accountSearch: 'alice', pageSize: 25 }, ctx))
  const previous = page.sections.find((section) => section.id === 'accounts-view')?.blocks?.find((block) => block.id === 'accounts-previous')
  assert.equal(previous?.action, 'load-accounts')
  assert.deepEqual(previous?.input, {
    view: 'accounts', providerId: provider.id, accountState: 'ALL', accountSearch: 'alice', auditOutcome: 'ALL', auditSearch: '', accountPage: 1, auditPage: 1, pageSize: 25,
  })
})

test('创建或轮换密钥只在本次页面响应出现，不写入插件状态', async () => {
  const secret = 'secret-only-in-response'
  const { ctx, calls } = context({ createdSecret: secret })
  const result = await adminActions['create-provider']({ name: '测试接入', target: 'server-1::' }, ctx)
  assert.match(JSON.stringify(result), new RegExp(secret))
  assert.doesNotMatch(JSON.stringify(calls.storage), new RegExp(secret))
})

test('直接接入动作仍调用现有 Provider 管理能力', async () => {
  const { ctx, calls } = context()
  await adminActions['manage-provider']({ providerId: provider.id, operation: 'disable' }, ctx)
  assert.deepEqual(calls.updateProvider, [{ id: provider.id, input: { enabled: false } }])
})
