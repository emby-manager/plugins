import assert from 'node:assert/strict'
import test from 'node:test'
import plugin from './server.ts'

const handlers = plugin.externalAccountAdapters?.embyboss.handlers

function request(overrides: Record<string, unknown> = {}) {
  return {
    method: 'GET', path: '/emby/Users', params: {}, query: {}, headers: {}, body: null, requestId: null,
    ...overrides,
  } as never
}

const account = {
  id: 'ea-user-1', name: 'alice', hasPassword: true, serverId: 'ea-1',
  dateCreated: '2026-08-06T00:00:00.000Z', state: 'ACTIVE', expiresAt: null,
  policy: { IsAdministrator: false, IsDisabled: false },
  configuration: { PlayDefaultAudioTrack: true, DisplayMissingEpisodes: false },
}

function health(overrides: Record<string, unknown> = {}) {
  return {
    state: 'online', checkedAt: '2000-01-01T00:00:00.000Z', latencyMs: 7, version: '1.0.0', message: null,
    ...overrides,
  }
}

test('EmbyBoss adapter maps the normalized account without exposing ledger IDs', async () => {
  const response = await handlers?.['list-users'](request(), {
    externalAccounts: { listAccounts: async () => [account] },
  } as never)
  assert.equal(response?.status, 200)
  assert.deepEqual(response?.body, [{
    Id: 'ea-user-1', Name: 'alice', HasPassword: true, HasConfiguredPassword: true,
    ServerId: 'ea-1', DateCreated: '2026-08-06T00:00:00.000Z',
    Policy: account.policy, Configuration: account.configuration,
  }])
})

test('EmbyBoss adapter returns an empty session list when provider health is online', async () => {
  const response = await handlers?.['list-sessions'](request({ path: '/emby/Sessions' }), {
    externalAccounts: { getHealth: async () => health() },
  } as never)
  assert.equal(response?.status, 200)
  assert.deepEqual(response?.body, [])
})

test('EmbyBoss adapter preserves a provider health failure for the session fallback', async () => {
  const response = await handlers?.['list-sessions'](request({ path: '/emby/Sessions' }), {
    externalAccounts: { getHealth: async () => health({ state: 'offline', message: '健康检查失败' }) },
  } as never)
  assert.equal(response?.status, 503)
  assert.equal((response?.body as any).code, 'external_account_provider_unavailable')
})

test('EmbyBoss adapter preserves query paging and case-insensitive fields', async () => {
  const response = await handlers?.['query-users'](request({
    query: { searchterm: 'LIC', startindex: '0', limit: '1' },
  }), {
    externalAccounts: { listAccounts: async () => [account, { ...account, id: '2', name: 'bob' }] },
  } as never)
  assert.equal((response?.body as any).TotalRecordCount, 1)
  assert.equal((response?.body as any).Items[0].Name, 'alice')
})

test('EmbyBoss adapter forwards create idempotency only through the host capability', async () => {
  let input: unknown
  const response = await handlers?.['create-user'](request({
    method: 'POST', body: { username: 'alice', pw: 'secret' }, requestId: 'request-1',
  }), {
    externalAccounts: {
      createAccount: async (value: unknown) => { input = value; return { account, created: true } },
    },
  } as never)
  assert.equal(response?.status, 200)
  assert.deepEqual(input, { name: 'alice', password: 'secret', expiresAt: null, idempotencyKey: 'request-1' })
})

test('EmbyBoss adapter converts denied host capabilities into bounded protocol errors', async () => {
  const denied = Object.assign(new Error('插件没有获得 external-account.account.read 权限'), {
    code: 'PLUGIN_CAPABILITY_DENIED', status: 403,
  })
  const response = await handlers?.['list-users'](request(), {
    externalAccounts: { listAccounts: async () => { throw denied } },
  } as never)
  assert.equal(response?.status, 403)
  assert.equal((response?.body as any).code, 'PLUGIN_CAPABILITY_DENIED')
})
