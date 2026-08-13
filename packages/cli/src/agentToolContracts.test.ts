import assert from 'node:assert/strict'
import test from 'node:test'
import { assertAgentToolRiskDeclarations } from './agentToolContracts.ts'

const risk = {
  resourceImportance: 'HIGH',
  reversible: false,
  maximumAffectedResources: 25,
  estimatedCostMinor: 1000,
}

test('supervised Agent Tools require a signed deterministic risk ceiling', () => {
  assert.throws(() => assertAgentToolRiskDeclarations([{
    name: 'dev.example.mutate', executionMode: 'SUPERVISED_WRITE',
  }]), /must declare bounded risk/)
  assert.doesNotThrow(() => assertAgentToolRiskDeclarations([{
    name: 'dev.example.mutate', executionMode: 'SUPERVISED_WRITE', risk,
  }]))
})

test('read-only Agent Tools cannot publish write risk', () => {
  assert.throws(() => assertAgentToolRiskDeclarations([{
    name: 'dev.example.read', executionMode: 'READ_ONLY', risk,
  }]), /cannot declare write risk/)
  assert.doesNotThrow(() => assertAgentToolRiskDeclarations([{
    name: 'dev.example.read', executionMode: 'READ_ONLY',
  }]))
})
