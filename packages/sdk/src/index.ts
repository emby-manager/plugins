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
  'emby.account.self.read',
  'emby.account.any.read',
  'emby.account.expiry.write',
  'emby.connection.self.read',
  'emby.library.read',
  'notification.self.send',
  'notification.any.send',
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
  routePackage: { id: number; name: string } | null
  accountCounts: Record<string, number>
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
  emby: {
    listMyAccounts(): Promise<unknown[]>
    listAccounts(userId: number): Promise<unknown[]>
    updateExpiry(accountId: number, activateTo: string): Promise<unknown>
    listMyConnections(): Promise<unknown[]>
    listLibrary(options?: { search?: string; limit?: number }): Promise<unknown[]>
  }
  notifications: {
    sendToMe(input: { title: string; message: string }): Promise<{ ok: true }>
    sendToUser(userId: number, input: { title: string; message: string }): Promise<{ ok: true }>
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
    reconcileProvider(providerId: string): Promise<{ checked: number; repaired: number; failed: number }>
    listAccounts(input?: { providerId?: string; state?: string; search?: string }): Promise<ExternalAccountAdminAccount[]>
    reconcileAccount(providerId: string, accountId: string): Promise<unknown>
    deleteAccount(providerId: string, accountId: string): Promise<{ deleted: boolean }>
    listAudits(input?: { providerId?: string }): Promise<Array<{
      id: number
      createdAt: string
      action: string
      outcome: string
      ip: string | null
      provider: { id: string; name: string }
      account: { id: string; externalName: string } | null
    }>>
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
