import { createHash, randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'

export const DOWNLOAD_PROVIDER_PROTOCOL = 'emby-manager.download@1.0' as const
export const ISOLATED_CONFIRMATION = 'RUN_ISOLATED_DOWNLOAD_PROVIDER_CONFORMANCE' as const

export type DownloadProviderOperation = 'submit' | 'status' | 'cancel'
export type DownloadProviderState =
  | 'ACCEPTED'
  | 'SEARCHING'
  | 'DOWNLOADING'
  | 'ORGANIZING'
  | 'FULFILLED'
  | 'FAILED'
  | 'CANCELLED'
  | 'UNKNOWN'

export interface DownloadProviderConformanceOptions {
  authorization: {
    isolatedSandbox: boolean
    writesAndCancellationApproved: boolean
    confirmation: string
  }
  invoke: (
    operation: DownloadProviderOperation,
    input: Readonly<Record<string, unknown>>,
    context: { signal: AbortSignal },
  ) => Promise<unknown>
  timeoutMs?: number
  reconciliationAttempts?: number
  reconciliationIntervalMs?: number
  maximumClockSkewMs?: number
}

export interface DownloadProviderConformanceCase {
  id:
    | 'response-loss-reconciliation'
    | 'duplicate-submit-idempotency'
    | 'status-monotonicity'
    | 'duplicate-cancel-idempotency'
    | 'cancelled-terminal-fact'
  status: 'PASSED' | 'FAILED' | 'SKIPPED'
  code: string
  durationMs: number
  evidence: {
    states?: string[]
    providerJobRefDigest?: string
  }
}

export interface DownloadProviderConformanceReport {
  schemaVersion: '1.0'
  protocol: typeof DOWNLOAD_PROVIDER_PROTOCOL
  runId: string
  status: 'PASSED' | 'FAILED'
  startedAt: string
  completedAt: string
  durationMs: number
  safety: {
    isolatedSandboxConfirmed: true
    containsSensitiveProviderData: false
    substitutesProductionAcceptance: false
  }
  cases: DownloadProviderConformanceCase[]
}

type ProviderResult = {
  providerJobRef: string | null
  state: string
  observedAt: string
}

class ConformanceFailure extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.code = code
  }
}

const TERMINAL_STATES = new Set<DownloadProviderState>(['FULFILLED', 'FAILED', 'CANCELLED'])
const STATUS_RANK: Record<DownloadProviderState, number> = {
  UNKNOWN: 0,
  ACCEPTED: 1,
  SEARCHING: 2,
  DOWNLOADING: 3,
  ORGANIZING: 4,
  FULFILLED: 5,
  FAILED: 5,
  CANCELLED: 5,
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number) {
  if (value == null) return fallback
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new ConformanceFailure('INVALID_RUNNER_LIMIT')
  }
  return value
}

function digestOpaque(value: string, reportSalt: string) {
  // The salt is intentionally never returned. Even a short sequential job ID
  // cannot be recovered from a report with a small dictionary.
  return createHash('sha256').update(reportSalt).update('\0').update(value).digest('hex').slice(0, 16)
}

function asResult(value: unknown, allowedStates: readonly string[], maximumClockSkewMs: number): ProviderResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConformanceFailure('INVALID_RESULT_OBJECT')
  }
  const result = value as Record<string, unknown>
  if (result.providerJobRef !== null && (typeof result.providerJobRef !== 'string' || result.providerJobRef.length < 1 || result.providerJobRef.length > 191)) {
    throw new ConformanceFailure('INVALID_PROVIDER_JOB_REF')
  }
  if (typeof result.state !== 'string' || !allowedStates.includes(result.state)) {
    throw new ConformanceFailure('INVALID_PROVIDER_STATE')
  }
  if (typeof result.observedAt !== 'string' || result.observedAt.length < 20 || result.observedAt.length > 40) {
    throw new ConformanceFailure('INVALID_OBSERVED_AT')
  }
  const observedAt = Date.parse(result.observedAt)
  if (!Number.isFinite(observedAt) || Math.abs(Date.now() - observedAt) > maximumClockSkewMs) {
    throw new ConformanceFailure('UNTRUSTWORTHY_OBSERVED_AT')
  }
  return {
    providerJobRef: result.providerJobRef as string | null,
    state: result.state,
    observedAt: result.observedAt,
  }
}

function sleep(milliseconds: number) {
  return new Promise<void>(resolve => setTimeout(resolve, milliseconds))
}

function caseResult(
  id: DownloadProviderConformanceCase['id'],
  status: DownloadProviderConformanceCase['status'],
  code: string,
  startedAt: number,
  evidence: DownloadProviderConformanceCase['evidence'] = {},
): DownloadProviderConformanceCase {
  return {
    id,
    status,
    code,
    durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    evidence,
  }
}

/**
 * Runs semantic checks against a disposable Download Provider sandbox.
 *
 * This intentionally performs writes. It refuses to start without the exact
 * confirmation phrase and stops after an uncertain invocation timeout.
 */
export async function runDownloadProviderConformance(
  options: DownloadProviderConformanceOptions,
): Promise<DownloadProviderConformanceReport> {
  if (
    options.authorization.isolatedSandbox !== true
    || options.authorization.writesAndCancellationApproved !== true
    || options.authorization.confirmation !== ISOLATED_CONFIRMATION
  ) {
    throw new ConformanceFailure('ISOLATED_SANDBOX_CONFIRMATION_REQUIRED')
  }

  const timeoutMs = boundedInteger(options.timeoutMs, 10_000, 250, 60_000)
  const attempts = boundedInteger(options.reconciliationAttempts, 5, 1, 20)
  const intervalMs = boundedInteger(options.reconciliationIntervalMs, 250, 0, 5_000)
  const maximumClockSkewMs = boundedInteger(options.maximumClockSkewMs, 10 * 60_000, 1_000, 24 * 60 * 60_000)
  const runId = randomUUID()
  const reportSalt = randomUUID()
  const startedWallTime = new Date()
  const startedMonotonic = performance.now()
  const cases: DownloadProviderConformanceCase[] = []
  let fatal = false

  const invoke = async (operation: DownloadProviderOperation, input: Readonly<Record<string, unknown>>) => {
    if (fatal) throw new ConformanceFailure('RUN_STOPPED_AFTER_UNCERTAIN_INVOCATION')
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        options.invoke(operation, input, { signal: controller.signal }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            fatal = true
            controller.abort()
            reject(new ConformanceFailure('INVOCATION_TIMEOUT'))
          }, timeoutMs)
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  const submitCommandId = `conformance-submit-${runId}`
  const contentRequestId = `conformance-request-${runId}`
  const cancelCommandId = `conformance-cancel-${runId}`
  const submitInput = Object.freeze({
    commandId: submitCommandId,
    contentRequest: Object.freeze({
      id: contentRequestId,
      title: 'Isolated conformance fixture',
      mediaType: 'MOVIE',
      externalIds: Object.freeze([]),
    }),
    target: Object.freeze({ serverId: `conformance-target-${runId}` }),
  })
  const statusInput = (providerJobRef?: string) => Object.freeze({
    commandId: submitCommandId,
    contentRequestId,
    ...(providerJobRef ? { providerJobRef } : {}),
  })

  let recovered: ProviderResult | null = null
  {
    const caseStarted = performance.now()
    try {
      // Intentionally discard the write response. The next operation has no
      // providerJobRef and must recover only from the stable command ID.
      await invoke('submit', submitInput)
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const observed = asResult(
          await invoke('status', statusInput()),
          Object.keys(STATUS_RANK),
          maximumClockSkewMs,
        )
        if (observed.providerJobRef && observed.state !== 'UNKNOWN') {
          recovered = observed
          break
        }
        if (attempt + 1 < attempts) await sleep(intervalMs)
      }
      if (!recovered?.providerJobRef) throw new ConformanceFailure('COMMAND_ID_RECONCILIATION_FAILED')
      cases.push(caseResult('response-loss-reconciliation', 'PASSED', 'COMMAND_ID_RECOVERED', caseStarted, {
        states: [recovered.state],
        providerJobRefDigest: digestOpaque(recovered.providerJobRef, reportSalt),
      }))
    } catch (error) {
      const code = error instanceof ConformanceFailure ? error.code : 'INVOCATION_FAILED'
      cases.push(caseResult('response-loss-reconciliation', 'FAILED', code, caseStarted))
    }
  }

  if (!recovered?.providerJobRef || fatal) {
    const remaining: DownloadProviderConformanceCase['id'][] = [
      'duplicate-submit-idempotency',
      'status-monotonicity',
      'duplicate-cancel-idempotency',
      'cancelled-terminal-fact',
    ]
    remaining.forEach(id => cases.push(caseResult(id, 'SKIPPED', fatal ? 'UNCERTAIN_INVOCATION_STOP' : 'PREREQUISITE_FAILED', performance.now())))
  } else {
    const providerJobRef = recovered.providerJobRef
    let duplicateSubmitPassed = false
    {
      const caseStarted = performance.now()
      try {
        const first = asResult(await invoke('submit', submitInput), ['ACCEPTED', 'RECONCILIATION_REQUIRED'], maximumClockSkewMs)
        const second = asResult(await invoke('submit', submitInput), ['ACCEPTED', 'RECONCILIATION_REQUIRED'], maximumClockSkewMs)
        if (
          (first.providerJobRef !== null && first.providerJobRef !== providerJobRef)
          || (second.providerJobRef !== null && second.providerJobRef !== providerJobRef)
        ) {
          throw new ConformanceFailure('DUPLICATE_SUBMIT_CREATED_DIFFERENT_JOB')
        }
        duplicateSubmitPassed = true
        cases.push(caseResult('duplicate-submit-idempotency', 'PASSED', 'STABLE_PROVIDER_JOB_REF', caseStarted, {
          states: [first.state, second.state],
          providerJobRefDigest: digestOpaque(providerJobRef, reportSalt),
        }))
      } catch (error) {
        const code = error instanceof ConformanceFailure ? error.code : 'INVOCATION_FAILED'
        cases.push(caseResult('duplicate-submit-idempotency', 'FAILED', code, caseStarted))
      }
    }

    if (!duplicateSubmitPassed || fatal) {
      const remaining: DownloadProviderConformanceCase['id'][] = [
        'status-monotonicity',
        'duplicate-cancel-idempotency',
        'cancelled-terminal-fact',
      ]
      remaining.forEach(id => cases.push(caseResult(id, 'SKIPPED', fatal ? 'UNCERTAIN_INVOCATION_STOP' : 'IDENTITY_PREREQUISITE_FAILED', performance.now())))
    } else {
      let statusPassed = false
      {
        const caseStarted = performance.now()
        try {
          const observations: ProviderResult[] = []
          for (let index = 0; index < 3; index += 1) {
            observations.push(asResult(await invoke('status', statusInput(providerJobRef)), Object.keys(STATUS_RANK), maximumClockSkewMs))
            if (index < 2) await sleep(intervalMs)
          }
          for (let index = 1; index < observations.length; index += 1) {
            const previous = observations[index - 1].state as DownloadProviderState
            const current = observations[index].state as DownloadProviderState
            if (TERMINAL_STATES.has(previous) && current !== previous) throw new ConformanceFailure('TERMINAL_STATE_REGRESSED')
            if (STATUS_RANK[current] < STATUS_RANK[previous]) throw new ConformanceFailure('PROVIDER_STATE_REGRESSED')
            if (observations[index].providerJobRef !== providerJobRef) throw new ConformanceFailure('STATUS_JOB_REF_CHANGED')
          }
          statusPassed = true
          cases.push(caseResult('status-monotonicity', 'PASSED', 'MONOTONIC_STATUS', caseStarted, {
            states: observations.map(item => item.state),
            providerJobRefDigest: digestOpaque(providerJobRef, reportSalt),
          }))
        } catch (error) {
          const code = error instanceof ConformanceFailure ? error.code : 'INVOCATION_FAILED'
          cases.push(caseResult('status-monotonicity', 'FAILED', code, caseStarted))
        }
      }

      if (!statusPassed || fatal) {
        const remaining: DownloadProviderConformanceCase['id'][] = [
          'duplicate-cancel-idempotency',
          'cancelled-terminal-fact',
        ]
        remaining.forEach(id => cases.push(caseResult(id, 'SKIPPED', fatal ? 'UNCERTAIN_INVOCATION_STOP' : 'STATUS_PREREQUISITE_FAILED', performance.now())))
      } else {
        const cancelInput = Object.freeze({
          commandId: cancelCommandId,
          providerJobRef,
          contentRequestId,
          reason: 'Isolated conformance cleanup',
        })
        {
          const caseStarted = performance.now()
          try {
            const first = asResult(await invoke('cancel', cancelInput), ['CANCELLED', 'ALREADY_TERMINAL', 'RECONCILIATION_REQUIRED'], maximumClockSkewMs)
            const second = asResult(await invoke('cancel', cancelInput), ['CANCELLED', 'ALREADY_TERMINAL', 'RECONCILIATION_REQUIRED'], maximumClockSkewMs)
            if (first.providerJobRef !== providerJobRef || second.providerJobRef !== providerJobRef) {
              throw new ConformanceFailure('DUPLICATE_CANCEL_CHANGED_JOB_REF')
            }
            if (first.state === 'RECONCILIATION_REQUIRED' && second.state === 'RECONCILIATION_REQUIRED') {
              throw new ConformanceFailure('CANCEL_DID_NOT_CONVERGE')
            }
            cases.push(caseResult('duplicate-cancel-idempotency', 'PASSED', 'STABLE_CANCEL_RESULT', caseStarted, {
              states: [first.state, second.state],
              providerJobRefDigest: digestOpaque(providerJobRef, reportSalt),
            }))
          } catch (error) {
            const code = error instanceof ConformanceFailure ? error.code : 'INVOCATION_FAILED'
            cases.push(caseResult('duplicate-cancel-idempotency', 'FAILED', code, caseStarted))
          }
        }

        {
          const caseStarted = performance.now()
          try {
            let cancelled: ProviderResult | null = null
            for (let attempt = 0; attempt < attempts; attempt += 1) {
              const observed = asResult(await invoke('status', statusInput(providerJobRef)), Object.keys(STATUS_RANK), maximumClockSkewMs)
              if (observed.providerJobRef !== providerJobRef) throw new ConformanceFailure('STATUS_JOB_REF_CHANGED')
              if (observed.state === 'CANCELLED') {
                cancelled = observed
                break
              }
              if (TERMINAL_STATES.has(observed.state as DownloadProviderState)) {
                throw new ConformanceFailure('CANCEL_REACHED_DIFFERENT_TERMINAL_STATE')
              }
              if (attempt + 1 < attempts) await sleep(intervalMs)
            }
            if (!cancelled) throw new ConformanceFailure('CANCELLED_FACT_NOT_OBSERVED')
            cases.push(caseResult('cancelled-terminal-fact', 'PASSED', 'CANCELLED_CONFIRMED_BY_READ', caseStarted, {
              states: [cancelled.state],
              providerJobRefDigest: digestOpaque(providerJobRef, reportSalt),
            }))
          } catch (error) {
            const code = error instanceof ConformanceFailure ? error.code : 'INVOCATION_FAILED'
            cases.push(caseResult('cancelled-terminal-fact', 'FAILED', code, caseStarted))
          }
        }
      }
    }
  }

  const completedAt = new Date()
  return {
    schemaVersion: '1.0',
    protocol: DOWNLOAD_PROVIDER_PROTOCOL,
    runId,
    status: cases.every(item => item.status === 'PASSED') ? 'PASSED' : 'FAILED',
    startedAt: startedWallTime.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: Math.max(0, Math.round(performance.now() - startedMonotonic)),
    safety: {
      isolatedSandboxConfirmed: true,
      containsSensitiveProviderData: false,
      substitutesProductionAcceptance: false,
    },
    cases,
  }
}
