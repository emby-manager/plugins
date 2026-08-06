import {
  definePlugin,
  type ExternalAccountAdapterRequest,
  type ExternalAccountAdapterResponse,
  type ExternalAccountSnapshot,
  type PluginContext,
} from '@emby-manager/plugin-sdk'
import { adminActions } from './admin.ts'

function field(body: unknown, ...names: string[]): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined
  const entries = Object.entries(body as Record<string, unknown>)
  for (const name of names) {
    const match = entries.find(([key]) => key.toLocaleLowerCase('en-US') === name.toLocaleLowerCase('en-US'))
    if (match) return match[1]
  }
  return undefined
}

function queryValue(request: ExternalAccountAdapterRequest, ...names: string[]): string {
  for (const name of names) {
    const entry = Object.entries(request.query)
      .find(([key]) => key.toLocaleLowerCase('en-US') === name.toLocaleLowerCase('en-US'))
    if (entry) return String(Array.isArray(entry[1]) ? entry[1][0] || '' : entry[1])
  }
  return ''
}

function user(account: ExternalAccountSnapshot) {
  return {
    Id: account.id,
    Name: account.name,
    HasPassword: account.hasPassword,
    HasConfiguredPassword: account.hasPassword,
    ServerId: account.serverId,
    DateCreated: account.dateCreated,
    Policy: account.policy,
    Configuration: account.configuration,
  }
}

function empty(status = 204): ExternalAccountAdapterResponse {
  return { status }
}

function upstream(result: { status: number; contentType: string; body: unknown }): ExternalAccountAdapterResponse {
  return { status: result.status, headers: { 'content-type': result.contentType }, body: result.body }
}

function failure(error: unknown): ExternalAccountAdapterResponse {
  const source = error as { message?: unknown; code?: unknown; status?: unknown }
  const status = Number(source?.status)
  const safeStatus = Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500
  const message = typeof source?.message === 'string' ? source.message : 'External account request failed'
  return {
    status: safeStatus,
    body: {
      Message: message,
      message,
      code: typeof source?.code === 'string' ? source.code : 'external_adapter_error',
    },
  }
}

function handler(
  run: (request: ExternalAccountAdapterRequest, context: PluginContext) => Promise<ExternalAccountAdapterResponse>,
) {
  return async (request: ExternalAccountAdapterRequest, context: PluginContext) => {
    try { return await run(request, context) } catch (error) { return failure(error) }
  }
}

const handlers = {
  'system-info': handler(async (_request, ctx) => {
    const provider = await ctx.externalAccounts.getProvider()
    return {
      status: 200,
      body: {
        Id: provider.server.id,
        ServerName: provider.server.name,
        Version: 'EM External Account Gateway/2',
        ProductName: 'Emby Manager',
        OperatingSystemDisplayName: 'EM managed EA',
      },
    }
  }),

  'list-libraries': handler(async (_request, ctx) => upstream(await ctx.externalAccounts.listLibraries())),

  'list-users': handler(async (_request, ctx) => ({
    status: 200,
    body: (await ctx.externalAccounts.listAccounts()).map(user),
  })),

  'query-users': handler(async (request, ctx) => {
    const accounts = await ctx.externalAccounts.listAccounts()
    const nameStart = queryValue(request, 'NameStartsWithOrGreater').trim().toLocaleLowerCase('en-US')
    const searchTerm = queryValue(request, 'SearchTerm').trim().toLocaleLowerCase('en-US')
    const filtered = accounts.filter((account) => {
      const name = account.name.toLocaleLowerCase('en-US')
      return (!nameStart || name.startsWith(nameStart)) && (!searchTerm || name.includes(searchTerm))
    })
    const start = Math.max(0, Number(queryValue(request, 'StartIndex')) || 0)
    const limit = Math.min(500, Math.max(1, Number(queryValue(request, 'Limit')) || filtered.length || 1))
    return {
      status: 200,
      body: {
        Items: filtered.slice(start, start + limit).map(user),
        TotalRecordCount: filtered.length,
        StartIndex: start,
      },
    }
  }),

  'get-user': handler(async (request, ctx) => ({
    status: 200,
    body: user(await ctx.externalAccounts.getAccount(request.params.accountId)),
  })),

  'create-user': handler(async (request, ctx) => {
    const expires = field(request.body, 'ExpiresAt', 'ExpiryDate')
    const password = field(request.body, 'Password', 'Pw', 'NewPw')
    const result = await ctx.externalAccounts.createAccount({
      name: field(request.body, 'Name', 'Username'),
      password: typeof password === 'string' ? password : undefined,
      expiresAt: expires == null ? null : String(expires),
      idempotencyKey: request.requestId,
    })
    return { status: 200, body: user(result.account) }
  }),

  'set-password': handler(async (request, ctx) => {
    const account = await ctx.externalAccounts.getAccount(request.params.accountId)
    const requestedId = field(request.body, 'Id')
    if (requestedId && String(requestedId) !== account.id) {
      return { status: 400, body: { Message: '请求中的用户 ID 与路径不一致' } }
    }
    let password = field(request.body, 'NewPw', 'Password', 'Pw')
    if (field(request.body, 'ResetPassword') === true && password === undefined) password = ''
    if (typeof password !== 'string') return { status: 400, body: { Message: 'NewPw 或 ResetPassword 必填' } }
    await ctx.externalAccounts.setPassword(account.id, password)
    return empty()
  }),

  'set-policy': handler(async (request, ctx) => {
    await ctx.externalAccounts.setPolicy(request.params.accountId, request.body)
    return empty()
  }),

  'delete-user': handler(async (request, ctx) => {
    await ctx.externalAccounts.deleteAccount(request.params.accountId)
    return empty()
  }),

  'authenticate-user': handler(async (request, ctx) => {
    const password = field(request.body, 'Pw', 'Password')
    const result = await ctx.externalAccounts.authenticate(
      field(request.body, 'Username', 'Name'),
      typeof password === 'string' ? password : '',
    )
    const mapped = user(result.account)
    return {
      status: 200,
      body: {
        User: mapped,
        SessionInfo: { UserId: mapped.Id, UserName: mapped.Name },
        ServerId: result.serverId,
      },
    }
  }),

  'list-items': handler(async (request, ctx) => upstream(
    await ctx.externalAccounts.listItems(request.params.accountId, request.query),
  )),

  'get-item': handler(async (request, ctx) => upstream(
    await ctx.externalAccounts.getItem(request.params.accountId, request.params.itemId, request.query),
  )),

  'set-favorite': handler(async (request, ctx) => upstream(
    await ctx.externalAccounts.setFavorite(
      request.params.accountId,
      request.params.itemId,
      request.method === 'POST',
      request.query,
    ),
  )),
}

export default definePlugin({
  actions: adminActions,
  externalAccountAdapters: {
    fabric: { handlers },
  },
})
