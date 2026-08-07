import assert from 'node:assert/strict'
import test from 'node:test'
import type { PluginContext } from '@emby-manager/plugin-sdk'
import plugin from './server.ts'

function context() {
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
      get: async () => ({ value: 2, updatedAt: new Date(0).toISOString() }),
      set: async () => ({ ok: true as const }),
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
  return { ctx, calls }
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
