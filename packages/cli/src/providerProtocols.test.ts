import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { assertProviderProtocol, type ProviderProtocolSpec } from './providerProtocols.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const download = JSON.parse(fs.readFileSync(path.join(root, 'schemas/providers/download-v1.json'), 'utf8')) as ProviderProtocolSpec

function manifest() {
  return {
    id: 'download',
    kind: download.kind,
    protocol: { id: download.id, version: download.version },
    operations: download.operations.map(operation => ({ ...operation })),
  }
}

test('official download protocol requires exact operation modes and wire schemas', () => {
  assert.deepEqual(assertProviderProtocol(manifest(), [download]), {
    conformance: 'VERIFIED', protocol: 'emby-manager.download@1.0',
  })

  const wrongMode = manifest()
  wrongMode.operations[0] = { ...wrongMode.operations[0], executionMode: 'READ_ONLY' }
  assert.throws(() => assertProviderProtocol(wrongMode, [download]), /SUPERVISED_WRITE/)

  const missing = manifest()
  missing.operations = missing.operations.filter(operation => operation.name !== 'status')
  assert.throws(() => assertProviderProtocol(missing, [download]), /missing operation status/)

  const drifted = manifest()
  drifted.operations[1] = {
    ...drifted.operations[1],
    outputSchema: { ...drifted.operations[1].outputSchema, additionalProperties: true },
  }
  assert.throws(() => assertProviderProtocol(drifted, [download]), /outputSchema does not match/)
})

test('reserved protocol identities cannot be spoofed and custom protocols stay unverified', () => {
  const unsupported = manifest()
  unsupported.protocol.version = '2.0'
  assert.throws(() => assertProviderProtocol(unsupported, [download]), /unsupported reserved protocol/)

  const custom = manifest()
  custom.protocol = { id: 'dev.example.download', version: '1.0' }
  assert.deepEqual(assertProviderProtocol(custom, [download]), {
    conformance: 'DECLARED_UNVERIFIED', protocol: 'dev.example.download@1.0',
  })

  const legacy = manifest()
  delete (legacy as { protocol?: unknown }).protocol
  assert.deepEqual(assertProviderProtocol(legacy, [download]), {
    conformance: 'CUSTOM_UNVERIFIED', protocol: null,
  })
})
