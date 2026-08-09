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

test('EmbyBoss adapter rejects invalid usernames before calling the host', async () => {
  let called = false
  const response = await handlers?.['create-user'](request({
    method: 'POST', body: { username: 'a', pw: 'secret' }, requestId: 'request-invalid',
  }), {
    externalAccounts: {
      createAccount: async () => { called = true; return { account, created: true } },
    },
  } as never)
  assert.equal(response?.status, 400)
  assert.equal((response?.body as any).code, 'PLUGIN_CAPABILITY_INPUT_INVALID')
  assert.equal(called, false)
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

test('EmbyBoss adapter maps host input errors to bad requests', async () => {
  const invalid = Object.assign(new Error('用户名长度需要为 2-50 个字符'), {
    code: 'PLUGIN_CAPABILITY_INPUT_INVALID',
  })
  const response = await handlers?.['list-users'](request(), {
    externalAccounts: { listAccounts: async () => { throw invalid } },
  } as never)
  assert.equal(response?.status, 400)
  assert.equal((response?.body as any).code, 'PLUGIN_CAPABILITY_INPUT_INVALID')
})

test('EmbyBoss adapter preserves an upstream rate-limit status', async () => {
  const limited = Object.assign(new Error('上游请求过于频繁'), { upstreamStatus: 429 })
  const response = await handlers?.['list-users'](request(), {
    externalAccounts: { listAccounts: async () => { throw limited } },
  } as never)
  assert.equal(response?.status, 429)
  assert.equal((response?.body as any).code, 'external_adapter_error')
})

test('EmbyBoss adapter keeps unknown failures as internal errors', async () => {
  const response = await handlers?.['list-users'](request(), {
    externalAccounts: { listAccounts: async () => { throw new Error('host failed') } },
  } as never)
  assert.equal(response?.status, 500)
  assert.equal((response?.body as any).code, 'external_adapter_error')
})
