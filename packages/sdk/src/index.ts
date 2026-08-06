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
  'emby.library.read',
  'notification.self.send',
  'notification.any.send',
  'network.read',
  'network.write',
  'scheduler.read',
  'scheduler.write',
] as const

export type PluginCapability = (typeof PLUGIN_CAPABILITIES)[number]

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
}

export interface PluginDefinition {
  activate?(context: PluginContext): void | Promise<void>
  deactivate?(context: PluginContext): void | Promise<void>
  actions?: Record<string, (input: any, context: PluginContext) => unknown | Promise<unknown>>
  hooks?: Record<string, (payload: any, context: PluginContext) => void | Promise<void>>
}

export function definePlugin<T extends PluginDefinition>(definition: T): T {
  return definition
}
