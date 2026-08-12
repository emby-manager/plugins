import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  assertEventContractRegistry,
  assertEventSubscriptions,
  type PluginEventContractRegistry,
} from './eventContracts.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const registry = JSON.parse(
  fs.readFileSync(path.join(root, 'schemas/events/plugin-events-v1.json'), 'utf8'),
) as PluginEventContractRegistry

test('published event registry is bounded and accepts exact public fields', () => {
  assert.doesNotThrow(() => assertEventContractRegistry(registry))
  assert.doesNotThrow(() => assertEventSubscriptions([{
    type: 'content.available',
    contractVersion: '1.0',
    handler: 'on-content-available',
    dataFields: ['workId', 'serverId'],
  }], registry))
})

test('event contracts reject internal events, future versions and private fields', () => {
  assert.throws(() => assertEventSubscriptions([{
    type: 'playback.progressed', contractVersion: '1.0', handler: 'on-progress', dataFields: [],
  }], registry), /not public/)
  assert.throws(() => assertEventSubscriptions([{
    type: 'content.available', contractVersion: '2.0', handler: 'on-ready', dataFields: [],
  }], registry), /unsupported/)
  assert.throws(() => assertEventSubscriptions([{
    type: 'content.available', contractVersion: '1.0', handler: 'on-ready', dataFields: ['playableItemId'],
  }], registry), /not public/)
  assert.throws(() => assertEventSubscriptions([
    { type: 'content.available', contractVersion: '1.0', handler: 'on-ready', dataFields: ['workId'] },
    { type: 'content.available', contractVersion: '1.0', handler: 'on-ready-again', dataFields: ['serverId'] },
  ], registry), /more than once/)
})
