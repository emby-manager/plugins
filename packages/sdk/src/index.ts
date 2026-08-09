export const PLUGIN_API_VERSION = '2' as const

export const PLUGIN_CAPABILITIES = [
  'storage.kv.read',
  'storage.kv.write',
  'storage.secret.read',
  'storage.secret.write',
  'user.profile.self.read',
  'user.profile.any.read',
  'user.email.self.read',
  'user.email.any.read',
  'user.directory.read',
  'points.balance.self.read',
  'points.balance.any.read',
  'points.balance.self.spend',
  'points.balance.any.adjust',
  'emby.account.self.read',
  'emby.account.any.read',
  'emby.account.expiry.write',
  'emby.connection.self.read',
  'emby.library.read',
  'session.site.self.read',
  'session.site.any.read',
  'session.site.self.revoke',
  'session.site.any.revoke',
  'device.ea.self.read',
  'device.ea.any.read',
  'device.ea.self.revoke',
  'device.ea.any.revoke',
  'playback.session.self.read',
  'playback.session.any.read',
  'playback.session.self.stop',
  'playback.session.any.stop',
  'notification.self.send',
  'notification.any.send',
  'notification.broadcast.send',
  'network.read',
  'network.write',
  'scheduler.read',
  'scheduler.write',
  'external-account.provider.read',
  'external-account.account.read',
  'external-account.account.create',
  'external-account.account.authenticate',
  'external-account.account.password.write',
  'external-account.account.policy.write',
  'external-account.account.delete',
  'external-account.library.read',
  'external-account.items.read',
  'external-account.favorites.write',
  'external-account.provider.manage.read',
  'external-account.provider.manage.create',
  'external-account.provider.manage.update',
  'external-account.provider.manage.secret.rotate',
  'external-account.provider.manage.delete',
  'external-account.provider.manage.reconcile',
  'external-account.account.manage.read',
  'external-account.account.manage.reconcile',
  'external-account.account.manage.delete',
  'external-account.audit.read',
] as const

export type PluginCapability = (typeof PLUGIN_CAPABILITIES)[number]

export interface ExternalAccountAdapterRequest {
  method: string
  path: string
  params: Record<string, string>
  query: Record<string, string | string[]>
  headers: Record<string, string>
  body: unknown
  requestId: string | null
}

export interface ExternalAccountAdapterResponse {
  status: number
  headers?: Record<string, string>
  body?: unknown
}

export interface ExternalAccountSnapshot {
  id: string
  name: string
  hasPassword: boolean
  serverId: string
  dateCreated: string
  state: string
  expiresAt: string | null
  policy: Record<string, unknown>
  configuration: Record<string, unknown>
}

export interface OperationalSessionListOptions {
  limit?: number
  serverId?: string
  includeEnded?: boolean
}

export interface SiteSessionSnapshot {
  id: string
  kind: 'EM_SITE'
  /** True only for the login session that invoked the current plugin action. */
  current: boolean
  createdAt: string
  lastSeenAt: string
  expiresAt: string
  deviceId: string | null
  deviceName: string | null
  client: string | null
  ip: string | null
  userAgent: string | null
}

export interface EADeviceSnapshot {
  id: string
  kind: 'MEDIA_SERVER'
  server: { id: string; name: string; serverType: string }
  accountId: string | null
  embyUserId: string
  deviceId: string
  deviceName: string | null
  client: string
  ip: string
  createdAt: string
  lastSeenAt: string
  active: boolean
  blocked: boolean
  details: { type: string; applicationVersion: string | null }
}

export interface PlaybackSessionSnapshot {
  id: string
  server: { id: string; name: string; serverType: string }
  state: 'PLAYING' | 'PAUSED' | 'STOPPED' | 'STALE'
  item: {
    id: string
    name: string
    type: string | null
    year: string | null
    tmdbId: number | null
    imdbId: string | null
  }
  device: {
    id: string | null
    name: string | null
    client: string | null
    applicationVersion: string | null
    ip: string | null
  }
  positionTicks: string
  runtimeTicks: string | null
  startedAt: string
  lastSeenAt: string
  endedAt: string | null
  source: 'WEBHOOK' | 'POLL'
}

export interface PointBalanceSnapshot {
  userId: number
  balance: number
  unit: string
}

export interface PointMutationInput {
  /** Positive for spend; signed for an administrator adjustment. Maximum absolute value: 1,000,000. */
  amount: number
  /** Human-readable ledger reason, 1-256 characters. */
  reason: string
  /** Stable retry key. Reusing it with different input is rejected. */
  idempotencyKey: string
}

export interface PointMutationResult extends PointBalanceSnapshot {
  transactionId: string
  amount: number
  replayed: boolean
}

export interface ExternalAccountAdminProvider {
  id: string
  name: string
  slug: string
  kind: string
  adapterPluginId: string
  adapterId: string
  routePackageId: number | null
  enabled: boolean
  secretPrefix: string
  lastUsedAt: string | null
  server: { id: string; name: string; isActive: boolean }
  health?: {
    state: 'online' | 'offline' | 'misconfigured'
    checkedAt: string
    latencyMs: number | null
    version: string | null
    message: string | null
  }
  routePackage: { id: number; name: string } | null
  accountCounts: Record<string, number>
  reconcileStatus?: ExternalProviderReconcileResult | null
}

export interface ExternalAccountAdminAccount {
  id: string
  externalName: string
  state: string
  createdAt: string
  lastSyncAt: string | null
  failureReason: string | null
  provider: { id: string; name: string; kind: string; slug: string }
  server: { id: string; name: string }
  internalUser: { id: number; userName: string }
  embyUser: { id: number; embyId: string | null; activateTo: string | null } | null
}

export interface ExternalAccountAdminAudit {
  id: number
  createdAt: string
  action: string
  outcome: string
  ip: string | null
  provider: { id: string; name: string }
  account: { id: string; externalName: string } | null
}

export interface ExternalAccountAdminPage<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

/** New hosts return a page object; older 0.1.9.4 hosts returned a bounded array. */
export type ExternalAccountAdminPageCompat<T> = ExternalAccountAdminPage<T> | T[]

export interface ExternalProviderReconcileResult {
  running?: boolean
  checked: number
  completed?: number
  repaired: number
  failed: number
  retried?: number
  rateLimited?: number
  progress?: number
  durationMs?: number
  coalesced?: boolean
  startedAt?: string
  updatedAt?: string
  finishedAt?: string | null
  errorOverflow?: number
  errors?: Array<{
    id: string
    message: string
    attempts: number
    retryable: boolean
    upstreamStatus: number | null
  }>
}

export interface PluginContext {
  plugin: Readonly<{ id: string; version: string }>
  config: Readonly<Record<string, unknown>>
  log: {
    debug(message: string, details?: unknown): void
    info(message: string, details?: unknown): void
    warn(message: string, details?: unknown): void
    error(message: string, details?: unknown): void
  }
  storage: {
    get(key: string): Promise<{ value: unknown; updatedAt: string } | null>
    list(prefix?: string, limit?: number): Promise<Array<{ key: string; data: unknown; updatedAt: string }>>
    set(key: string, value: unknown): Promise<{ ok: true }>
    delete(key: string): Promise<{ deleted: boolean }>
  }
  secrets: {
    get(key: string): Promise<string | null>
    set(key: string, value: string): Promise<{ ok: true }>
    delete(key: string): Promise<{ deleted: boolean }>
  }
  users: {
    getMyProfile(): Promise<unknown>
    getProfile(userId: number): Promise<unknown>
    getMyEmail(): Promise<unknown>
    getEmail(userId: number): Promise<unknown>
    listDirectory(options?: { search?: string; limit?: number }): Promise<unknown[]>
  }
  points: {
    getMyBalance(): Promise<PointBalanceSnapshot>
    getBalance(userId: number): Promise<PointBalanceSnapshot>
    spend(input: PointMutationInput): Promise<PointMutationResult>
    adjust(userId: number, input: PointMutationInput): Promise<PointMutationResult>
  }
  emby: {
    listMyAccounts(): Promise<unknown[]>
    listAccounts(userId: number): Promise<unknown[]>
    updateExpiry(accountId: number, activateTo: string): Promise<unknown>
    listMyConnections(): Promise<unknown[]>
    listLibrary(options?: { search?: string; limit?: number }): Promise<unknown[]>
  }
  sessions: {
    listMySiteSessions(options?: OperationalSessionListOptions): Promise<SiteSessionSnapshot[]>
    listSiteSessions(userId: number, options?: OperationalSessionListOptions): Promise<SiteSessionSnapshot[]>
    revokeMySiteSession(sessionId: string): Promise<{ revoked: true; id: string }>
    revokeSiteSession(userId: number, sessionId: string): Promise<{ revoked: true; id: string }>
    listMyEADevices(options?: OperationalSessionListOptions): Promise<EADeviceSnapshot[]>
    listEADevices(userId: number, options?: OperationalSessionListOptions): Promise<EADeviceSnapshot[]>
    revokeMyEADevice(deviceId: string): Promise<{ revoked: true; id: string }>
    revokeEADevice(userId: number, deviceId: string): Promise<{ revoked: true; id: string }>
    listMyPlaybackSessions(options?: OperationalSessionListOptions): Promise<PlaybackSessionSnapshot[]>
    listPlaybackSessions(userId: number, options?: OperationalSessionListOptions): Promise<PlaybackSessionSnapshot[]>
    stopMyPlaybackSession(sessionId: string): Promise<{ stopped: true; alreadyStopped: boolean; id: string }>
    stopPlaybackSession(userId: number, sessionId: string): Promise<{ stopped: true; alreadyStopped: boolean; id: string }>
  }
  notifications: {
    sendToMe(input: { title: string; message: string }): Promise<{ ok: true }>
    sendToUser(userId: number, input: { title: string; message: string }): Promise<{ ok: true }>
    sendToAll(input: { title: string; message: string }): Promise<{ ok: true; recipientCount: number }>
  }
  network: { fetch(input: { url: string; method?: string; headers?: Record<string, string>; body?: unknown }): Promise<{ status: number; ok: boolean; headers: Record<string, string>; body: string }> }
  scheduler: {
    list(): Promise<Array<{
      name: string
      intervalSeconds: number
      payload: unknown
      enabled: boolean
      lastRunAt: string | null
      nextRunAt: string
      lastError: string | null
    }>>
    upsert(name: string, intervalSeconds: number, payload?: unknown): Promise<{
      name: string
      intervalSeconds: number
      enabled: boolean
      nextRunAt: string
    }>
    delete(name: string): Promise<{ deleted: boolean }>
  }
  externalAccounts: {
    getProvider(): Promise<{ id: string; name: string; kind: string; server: { id: string; name: string } }>
    listAccounts(): Promise<ExternalAccountSnapshot[]>
    getAccount(accountId: string): Promise<ExternalAccountSnapshot>
    createAccount(input: {
      name: unknown
      password?: string
      expiresAt?: string | null
      idempotencyKey?: string | null
    }): Promise<{ account: ExternalAccountSnapshot; created: boolean }>
    authenticate(name: unknown, password?: string): Promise<{ account: ExternalAccountSnapshot; serverId: string }>
    setPassword(accountId: string, password: string): Promise<{ ok: true }>
    setPolicy(accountId: string, policy: unknown): Promise<{ ok: true }>
    deleteAccount(accountId: string): Promise<{ ok: true }>
    listLibraries(): Promise<{ status: number; contentType: string; body: unknown }>
    listItems(accountId: string, query?: unknown): Promise<{ status: number; contentType: string; body: unknown }>
    getItem(accountId: string, itemId: string, query?: unknown): Promise<{ status: number; contentType: string; body: unknown }>
    setFavorite(accountId: string, itemId: string, favorite: boolean, query?: unknown): Promise<{ status: number; contentType: string; body: unknown }>
  }
  externalAccountsAdmin: {
    getOptions(): Promise<{
      servers: Array<{
        id: string
        name: string
        isActive: boolean
        ready: boolean
        routePackages: Array<{ id: number; name: string }>
      }>
      adapters: Array<{ id: string; name: string; kind: string; description?: string; addressHint?: string; configHint?: string }>
    }>
    listProviders(): Promise<ExternalAccountAdminProvider[]>
    createProvider(input: {
      name: string
      adapterId: string
      serverId: string
      routePackageId?: number | null
    }): Promise<{ provider: ExternalAccountAdminProvider; secret: string }>
    updateProvider(providerId: string, input: {
      name?: string
      enabled?: boolean
      routePackageId?: number | null
    }): Promise<ExternalAccountAdminProvider>
    rotateProviderSecret(providerId: string): Promise<{ provider: ExternalAccountAdminProvider; secret: string }>
    deleteProvider(providerId: string): Promise<{ deleted: boolean }>
    reconcileProvider(providerId: string): Promise<ExternalProviderReconcileResult>
    listAccounts(input?: {
      providerId?: string
      state?: string
      search?: string
      page?: number
      pageSize?: number
    }): Promise<ExternalAccountAdminPageCompat<ExternalAccountAdminAccount>>
    reconcileAccount(providerId: string, accountId: string): Promise<unknown>
    deleteAccount(providerId: string, accountId: string): Promise<{ deleted: boolean }>
    listAudits(input?: {
      providerId?: string
      accountId?: string
      action?: string
      outcome?: string
      search?: string
      page?: number
      pageSize?: number
    }): Promise<ExternalAccountAdminPageCompat<ExternalAccountAdminAudit>>
  }
}

export interface PluginDefinition {
  activate?(context: PluginContext): void | Promise<void>
  deactivate?(context: PluginContext): void | Promise<void>
  actions?: Record<string, (input: any, context: PluginContext) => unknown | Promise<unknown>>
  hooks?: Record<string, (payload: any, context: PluginContext) => void | Promise<void>>
  externalAccountAdapters?: Record<string, {
    handlers: Record<string, (
      request: ExternalAccountAdapterRequest,
      context: PluginContext,
    ) => ExternalAccountAdapterResponse | Promise<ExternalAccountAdapterResponse>>
  }>
}

export function definePlugin<T extends PluginDefinition>(definition: T): T {
  return definition
}
