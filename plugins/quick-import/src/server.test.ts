import assert from 'node:assert/strict'
import test from 'node:test'
import plugin from './server.ts'

const action = plugin.actions?.['build-senplayer-imports']

test('quick-import creates one bounded SenPlayer link per available server', async () => {
  assert.equal(typeof action, 'function')
  const result = await action!({ username: 'alice', password: 'test-pass' }, {
    emby: {
      listMyConnections: async () => [{
        id: 'server-1',
        name: 'Cinema',
        lines: [
          { id: 'line-1', name: 'Main', url: 'https://emby.example.test/' },
          { id: 'line-2', name: 'Backup', url: 'https://backup.example.test/' },
        ],
      }],
    },
  } as never) as { links: Array<{ url: string }> }

  assert.equal(result.links.length, 1)
  const link = new URL(result.links[0].url)
  assert.equal(link.protocol, 'senplayer:')
  assert.equal(link.searchParams.get('username'), 'alice')
  assert.equal(link.searchParams.get('password'), 'test-pass')
  assert.equal(link.searchParams.get('address'), 'https://emby.example.test/')
  assert.equal(link.searchParams.get('address1name'), 'Backup')
  assert.equal(link.searchParams.get('address1'), 'https://backup.example.test/')
})

test('quick-import rejects empty credentials and ignores unsafe addresses', async () => {
  await assert.rejects(() => action!({ username: '', password: 'test-pass' }, {} as never))
  const result = await action!({ username: 'alice', password: 'test-pass' }, {
    emby: {
      listMyConnections: async () => [{
        id: 'server-1',
        name: 'Cinema',
        lines: [{ id: 'line-1', name: 'Unsafe', url: 'javascript:alert(1)' }],
      }],
    },
  } as never) as { links: unknown[] }
  assert.deepEqual(result.links, [])
})
