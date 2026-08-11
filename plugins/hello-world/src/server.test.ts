import assert from 'node:assert/strict'
import test from 'node:test'
import type { PluginContext } from '@emby-manager/plugin-sdk'
import plugin from './server.ts'

function context() {
  const records = new Map<string, unknown>([['greetingCount', 2]])
  const calls = {
    self: [] as Array<{ title: string; message: string }>,
    users: [] as number[],
    broadcasts: [] as Array<{ title: string; message: string }>,
  }
  const ctx = {
    config: { greeting: '欢迎使用 EM 插件系统' },
    users: {
      getMyProfile: async () => ({ nickName: '测试用户', userName: 'tester' }),
    },
    storage: {
      get: async (key: string) => records.has(key)
        ? { value: records.get(key), updatedAt: new Date(0).toISOString() }
        : null,
      set: async (key: string, value: unknown) => {
        records.set(key, value)
        return { ok: true as const }
      },
    },
    notifications: {
      sendToMe: async (input: { title: string; message: string }) => {
        calls.self.push(input)
        return { ok: true as const }
      },
      sendToUser: async (userId: number) => {
        calls.users.push(userId)
        return { ok: true as const }
      },
      sendToAll: async (input: { title: string; message: string }) => {
        calls.broadcasts.push(input)
        return { ok: true as const, recipientCount: 7 }
      },
    },
  } as unknown as PluginContext
  return { ctx, calls, records }
}

test('greet always uses the self-scoped notification capability', async () => {
  const { ctx, calls } = context()
  const result = await plugin.actions!.greet({ userId: 999 }, ctx) as { message: string; count: number }
  assert.equal(calls.self.length, 1)
  assert.equal(calls.users.length, 0)
  assert.equal(calls.broadcasts.length, 0)
  assert.match(calls.self[0].message, /测试用户/)
  assert.equal(result.count, 3)
})

test('admin greeting uses only the dedicated broadcast capability', async () => {
  const { ctx, calls } = context()
  const result = await plugin.actions!['greet-everyone']({}, ctx) as { recipientCount: number }
  assert.equal(calls.self.length, 0)
  assert.equal(calls.users.length, 0)
  assert.equal(calls.broadcasts.length, 1)
  assert.equal(result.recipientCount, 7)
})

test('read-only agent tool returns only plugin-owned counters', async () => {
  const { ctx, records } = context()
  records.set('availableContentCount', 4)
  const result = await plugin.agentTools!['read-greeting-stats']({}, ctx) as {
    greetingCount: number
    availableContentCount: number
  }
  assert.deepEqual(result, { greetingCount: 2, availableContentCount: 4 })
})

test('durable event handler deduplicates by CloudEvent id', async () => {
  const { ctx, records } = context()
  const event = {
    specversion: '1.0' as const,
    id: 'event-1',
    source: '/em/content-requests',
    type: 'content.available',
    time: new Date(0).toISOString(),
    datacontenttype: 'application/json' as const,
    tenantId: 'site-default',
    correlationId: 'correlation-1',
    data: { contentRequestId: 'request-1', workId: 'work-1', serverId: 'ea-1' },
  }
  const handler = plugin.eventSubscriptions!['on-content-available']
  assert.deepEqual(await handler(event, ctx), { deduplicated: false })
  assert.deepEqual(await handler(event, ctx), { deduplicated: true })
  assert.equal(records.get('availableContentCount'), 1)
})

test('provider and workflow activity return data without host mutation', async () => {
  const { ctx, records } = context()
  const provider = await plugin.providers!['greeting-provider'].operations['compose-greeting']({ name: '小明' }, ctx)
  const activity = await plugin.workflowActivities!['compose-workflow-greeting']({ name: '小明' }, ctx)
  assert.deepEqual(provider, { message: '你好，小明！' })
  assert.deepEqual(activity, { message: '你好，小明！' })
  assert.equal(records.size, 1)
})
