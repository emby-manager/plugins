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

test('EmbyBoss adapter preserves the official ResetPassword clearing semantics', async () => {
  let nextPassword: string | undefined
  const response = await handlers?.['set-password'](request({
    method: 'POST', params: { accountId: account.id }, body: { ResetPassword: true },
  }), {
    externalAccounts: {
      getAccount: async () => account,
      setPassword: async (_accountId: string, password: string) => {
        nextPassword = password
        return { ok: true }
      },
    },
  } as never)
  assert.equal(response?.status, 204)
  assert.equal(nextPassword, '')
})

test('EmbyBoss adapter passes pure-letter passwords through unchanged', async () => {
  let nextPassword: string | undefined
  const response = await handlers?.['set-password'](request({
    method: 'POST', params: { accountId: account.id }, body: { NewPw: 'lettersOnly' },
  }), {
    externalAccounts: {
      getAccount: async () => account,
      setPassword: async (_accountId: string, password: string) => {
        nextPassword = password
        return { ok: true }
      },
    },
  } as never)
  assert.equal(response?.status, 204)
  assert.equal(nextPassword, 'lettersOnly')
})

test('EmbyBoss adapter exposes provider connectivity without fabricating playback sessions', async () => {
  const online = await handlers?.['list-sessions'](request(), {
    externalAccounts: {
      getHealth: async () => ({
        state: 'online', checkedAt: '2026-08-10T00:00:00.000Z', latencyMs: 12,
        version: 'v0.1.9.5', message: null,
      }),
    },
  } as never)
  assert.equal(online?.status, 200)
  assert.deepEqual(online?.body, [])

  const offline = await handlers?.['list-sessions'](request(), {
    externalAccounts: {
      getHealth: async () => ({
        state: 'offline', checkedAt: '2026-08-10T00:00:00.000Z', latencyMs: null,
        version: null, message: 'connection refused',
      }),
    },
  } as never)
  assert.equal(offline?.status, 503)
  assert.equal((offline?.body as any).code, 'EXTERNAL_PROVIDER_UNAVAILABLE')
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

test('EmbyBoss adapter preserves rate-limit status and Retry-After', async () => {
  const limited = Object.assign(new Error('HTTP 429: rate limited'), {
    upstreamStatus: 429,
    retryAfterMs: 7_000,
  })
  const response = await handlers?.['list-users'](request(), {
    externalAccounts: { listAccounts: async () => { throw limited } },
  } as never)
  assert.equal(response?.status, 429)
  assert.deepEqual(response?.headers, { 'retry-after': '7' })
  assert.equal((response?.body as any).code, 'EXTERNAL_ACCOUNT_RATE_LIMITED')
  assert.equal((response?.body as any).retryable, true)
})
