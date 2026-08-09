import type {
  ExternalAccountAdminAccount,
  ExternalAccountAdminAudit,
  ExternalAccountAdminPageCompat,
  ExternalAccountAdminProvider,
  PluginContext,
} from '@emby-manager/plugin-sdk'

type AdminNotice = { title: string; content: string; tone?: 'info' | 'success' | 'warning' | 'danger' }

interface DashboardFilters {
  providerId: string
  accountState: string
  accountSearch: string
  auditOutcome: string
  auditSearch: string
  accountPage: number
  auditPage: number
  pageSize: number
}

function boundedInteger(value: unknown, fallback: number, maximum: number): number {
  const result = Number(value)
  return Number.isSafeInteger(result) && result >= 1 ? Math.min(maximum, result) : fallback
}

function optionalText(value: unknown, maxLength = 100): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function dashboardFilters(value: unknown): DashboardFilters {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const providerId = optionalText(input.providerId, 191)
  return {
    providerId: providerId === 'ALL' ? '' : providerId,
    accountState: optionalText(input.accountState, 24).toUpperCase() || 'ALL',
    accountSearch: optionalText(input.accountSearch),
    auditOutcome: optionalText(input.auditOutcome, 32) || 'ALL',
    auditSearch: optionalText(input.auditSearch),
    accountPage: boundedInteger(input.accountPage, 1, 1_000_000),
    auditPage: boundedInteger(input.auditPage, 1, 1_000_000),
    pageSize: boundedInteger(input.pageSize, 25, 100),
  }
}

function normalizePage<T>(value: ExternalAccountAdminPageCompat<T>, requestedPage: number, pageSize: number) {
  if (Array.isArray(value)) {
    return { items: value, total: value.length, page: 1, pageSize: Math.max(1, value.length || pageSize), totalPages: value.length ? 1 : 0 }
  }
  return value && Array.isArray(value.items)
    ? value
    : { items: [] as T[], total: 0, page: requestedPage, pageSize, totalPages: 0 }
}

function navigationInput(filters: DashboardFilters, updates: Partial<DashboardFilters> = {}) {
  const value = { ...filters, ...updates }
  return {
    providerId: value.providerId || 'ALL',
    accountState: value.accountState,
    accountSearch: value.accountSearch,
    auditOutcome: value.auditOutcome,
    auditSearch: value.auditSearch,
    accountPage: value.accountPage,
    auditPage: value.auditPage,
    pageSize: value.pageSize,
  }
}

function text(value: unknown, name: string, maxLength = 191): string {
  const result = typeof value === 'string' ? value.trim() : ''
  if (!result || result.length > maxLength) throw new Error(`${name} 参数无效`)
  return result
}

function providerLabel(provider: ExternalAccountAdminProvider): string {
  return `${provider.name} · ${provider.server.name}`
}

function providerOptions(providers: ExternalAccountAdminProvider[]) {
  return providers.slice(0, 50).map((provider) => ({ label: providerLabel(provider), value: provider.id }))
}

function accountOptions(accounts: ExternalAccountAdminAccount[]) {
  return accounts.filter((account) => account.state !== 'DELETED').slice(0, 50).map((account) => ({
    label: `${account.externalName} · ${account.provider.name} · ${account.state}`,
    value: `${account.provider.id}::${account.id}`,
  }))
}

async function page(
  ctx: PluginContext,
  notice?: AdminNotice,
  oneTimeSecret?: { provider: ExternalAccountAdminProvider; secret: string },
  requestedFilters?: unknown,
) {
  const filters = dashboardFilters(requestedFilters)
  const [options, providers, accountResult, auditResult] = await Promise.all([
    ctx.externalAccountsAdmin.getOptions(),
    ctx.externalAccountsAdmin.listProviders(),
    ctx.externalAccountsAdmin.listAccounts({
      providerId: filters.providerId || undefined,
      state: filters.accountState,
      search: filters.accountSearch || undefined,
      page: filters.accountPage,
      pageSize: filters.pageSize,
    }),
    ctx.externalAccountsAdmin.listAudits({
      providerId: filters.providerId || undefined,
      outcome: filters.auditOutcome,
      search: filters.auditSearch || undefined,
      page: filters.auditPage,
      pageSize: filters.pageSize,
    }),
  ])
  const accountPage = normalizePage<ExternalAccountAdminAccount>(accountResult, filters.accountPage, filters.pageSize)
  const auditPage = normalizePage<ExternalAccountAdminAudit>(auditResult, filters.auditPage, filters.pageSize)
  const accounts = accountPage.items
  const audits = auditPage.items
  const adapter = options.adapters.find((item) => item.id === 'fabric')
  const targets = options.servers.flatMap((server) => {
    if (!server.ready) return []
    if (!server.routePackages.length) {
      return [{ label: `${server.name} · 服务器默认线路`, value: `${server.id}::` }]
    }
    return server.routePackages.map((routePackage) => ({
      label: `${server.name} · ${routePackage.name}`,
      value: `${server.id}::${routePackage.id}`,
    }))
  }).slice(0, 50)
  const active = providers.reduce((sum, provider) => sum + Number(provider.accountCounts?.ACTIVE || 0), 0)
  const issues = providers.reduce((sum, provider) => sum
    + Number(provider.accountCounts?.FAILED || 0)
    + Number(provider.accountCounts?.PENDING || 0)
    + Number(provider.accountCounts?.DELETE_PENDING || 0), 0)
  await ctx.storage.set('external-admin/state-v1', {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    providers: providers.map((provider) => ({
      id: provider.id,
      name: provider.name,
      adapterId: provider.adapterId,
      serverId: provider.server.id,
      routePackageId: provider.routePackageId,
      enabled: provider.enabled,
    })),
    accountPage: { total: accountPage.total, page: accountPage.page, pageSize: accountPage.pageSize },
    accounts: accounts.map((account) => ({
      id: account.id,
      providerId: account.provider.id,
      externalName: account.externalName,
      state: account.state,
      lastSyncAt: account.lastSyncAt,
      failureReason: account.failureReason?.slice(0, 500) || null,
    })),
  })

  const providerFilterOptions = [{ label: '全部接入', value: 'ALL' }, ...providerOptions(providers)]
  const accountNavigation = [
    ...(accountPage.page > 1 ? [{
      type: 'action', id: 'accounts-previous', title: '上一页', action: 'load-admin', variant: 'outline',
      input: navigationInput(filters, { accountPage: accountPage.page - 1 }),
    }] : []),
    ...(accountPage.page < accountPage.totalPages ? [{
      type: 'action', id: 'accounts-next', title: '下一页', action: 'load-admin', variant: 'outline',
      input: navigationInput(filters, { accountPage: accountPage.page + 1 }),
    }] : []),
  ]
  const auditNavigation = [
    ...(auditPage.page > 1 ? [{
      type: 'action', id: 'audits-previous', title: '上一页', action: 'load-admin', variant: 'outline',
      input: navigationInput(filters, { auditPage: auditPage.page - 1 }),
    }] : []),
    ...(auditPage.page < auditPage.totalPages ? [{
      type: 'action', id: 'audits-next', title: '下一页', action: 'load-admin', variant: 'outline',
      input: navigationInput(filters, { auditPage: auditPage.page + 1 }),
    }] : []),
  ]
  const reconciliationSummaries = providers.flatMap((provider) => {
    const status = provider.reconcileStatus
    if (!status) return []
    const headline = status.running
      ? `${provider.name}：进行中 ${status.progress ?? 0}%（${status.completed ?? 0}/${status.checked || '待统计'}），已重试 ${status.retried ?? 0} 次`
      : `${provider.name}：已完成，同步 ${status.repaired}，失败 ${status.failed}，重试 ${status.retried ?? 0} 次，耗时 ${Math.round((status.durationMs ?? 0) / 1000)} 秒`
    const errors = status.errors?.slice(0, 3).map((item) => `  - ${item.id}: ${item.message.slice(0, 180)}`) || []
    return [[headline, ...errors].join('\n')]
  }).slice(0, 20)

  return {
    version: 1,
    title: 'Fabric 外部账号接入',
    description: '页面与管理流程由 Fabric 插件提供；EM 仅在已批准的细分权限内代理 EA、密钥与审计操作。',
    sections: [
      {
        id: 'overview',
        columns: 3,
        blocks: [
          { type: 'metric', id: 'providers', title: '接入数', value: providers.length, description: '仅统计该 Fabric 插件所属接入' },
          { type: 'metric', id: 'active-accounts', title: '正常账号', value: active },
          { type: 'metric', id: 'account-issues', title: '待处理', value: issues, description: '待同步、失败或待删除' },
        ],
      },
      ...(notice ? [{ id: 'notice', blocks: [{ type: 'text', id: 'operation-notice', ...notice }] }] : []),
      ...(reconciliationSummaries.length ? [{ id: 'reconcile-progress', blocks: [{
        type: 'text', id: 'reconcile-progress-text', title: '全量对账进度',
        content: reconciliationSummaries.join('\n\n'),
        tone: providers.some((item) => !item.reconcileStatus?.running && Number(item.reconcileStatus?.failed || 0) > 0) ? 'warning' : 'info',
      }] }] : []),
      ...(oneTimeSecret ? [{
        id: 'secret',
        blocks: [{
          type: 'text',
          id: 'one-time-secret',
          title: '密钥只显示这一次',
          tone: 'warning',
          content: `接入基地址：/api/external/emby/${oneTimeSecret.provider.slug}\nEmby API 密钥：${oneTimeSecret.secret}\n\n在 Fabric 中填入当前 EM 站点域名 + 上述路径，不要追加 /emby。关闭或刷新后只能轮换密钥。`,
        }],
      }] : []),
      {
        id: 'create',
        title: '创建 Fabric 接入',
        description: '只显示已配置 Webhook 密钥的 EA；已启用线路套餐的 EA 必须选择一个套餐。',
        blocks: targets.length ? [{
          type: 'form',
          id: 'create-provider',
          action: 'create-provider',
          submitLabel: '创建并生成密钥',
          fields: [
            { name: 'name', label: '接入名称', type: 'text', required: true, placeholder: '例如：Fabric 公益服' },
            { name: 'target', label: '目标 EA 与默认线路', type: 'select', required: true, options: targets },
          ],
        }] : [{ type: 'text', id: 'no-target', title: '暂无可用 EA', tone: 'warning', content: '请先在服务器管理中配置 EA 与 Webhook 密钥。' }],
      },
      ...(providers.length ? [{
        id: 'provider-actions',
        title: '接入操作',
        columns: 2,
        blocks: [{
          type: 'form',
          id: 'manage-provider',
          action: 'manage-provider',
          submitLabel: '执行接入操作',
          fields: [
            { name: 'providerId', label: '接入', type: 'select', required: true, options: providerOptions(providers) },
            { name: 'operation', label: '操作', type: 'select', required: true, options: [
              { label: '启用', value: 'enable' },
              { label: '停用', value: 'disable' },
              { label: '全量对账', value: 'reconcile' },
              { label: '轮换密钥', value: 'rotate-secret' },
              { label: '删除空接入', value: 'delete' },
            ] },
          ],
        }, {
          type: 'action',
          id: 'refresh',
          title: '刷新数据',
          description: '重新读取接入、账号映射和审计。',
          action: 'load-admin',
          variant: 'outline',
        }],
      }] : []),
      {
        id: 'filters', title: '账号与审计筛选',
        description: '账号映射和审计分别分页读取；翻页会保留当前筛选条件。',
        blocks: [{
          type: 'form', id: 'list-filters', action: 'load-admin', submitLabel: '应用筛选',
          fields: [
            { name: 'providerId', label: '接入', type: 'select', defaultValue: filters.providerId || 'ALL', options: providerFilterOptions },
            { name: 'accountState', label: '账号状态', type: 'select', defaultValue: filters.accountState, options: [
              { label: '全部状态', value: 'ALL' }, { label: '正常', value: 'ACTIVE' }, { label: '待同步', value: 'PENDING' },
              { label: '失败', value: 'FAILED' }, { label: '已停用', value: 'DISABLED' },
              { label: '待删除', value: 'DELETE_PENDING' }, { label: '已删除', value: 'DELETED' },
            ] },
            { name: 'accountSearch', label: '搜索账号', type: 'text', defaultValue: filters.accountSearch, placeholder: '外部身份或 EM 内部用户名' },
            { name: 'auditOutcome', label: '审计结果', type: 'select', defaultValue: filters.auditOutcome, options: [
              { label: '全部结果', value: 'ALL' }, { label: '成功', value: 'success' }, { label: '失败', value: 'failed' },
              { label: '部分成功', value: 'partial' }, { label: '重试中', value: 'retrying' },
            ] },
            { name: 'auditSearch', label: '搜索审计', type: 'text', defaultValue: filters.auditSearch, placeholder: '动作、账号、接入、请求 ID 或 IP' },
            { name: 'pageSize', label: '每页条数', type: 'select', defaultValue: String(filters.pageSize), options: [
              { label: '每页 10 条', value: '10' }, { label: '每页 25 条', value: '25' },
              { label: '每页 50 条', value: '50' }, { label: '每页 100 条', value: '100' },
            ] },
          ],
        }],
      },
      ...(accounts.some((account) => account.state !== 'DELETED') ? [{
        id: 'account-actions',
        title: '账号操作',
        blocks: [{
          type: 'form',
          id: 'manage-account',
          action: 'manage-account',
          submitLabel: '执行账号操作',
          fields: [
            { name: 'account', label: '外部账号', type: 'select', required: true, options: accountOptions(accounts) },
            { name: 'operation', label: '操作', type: 'select', required: true, options: [
              { label: '重新同步到 EA', value: 'reconcile' },
              { label: '从 EA 删除并保留审计', value: 'delete' },
            ] },
          ],
        }],
      }] : []),
      {
        id: 'provider-table',
        title: '已配置接入',
        blocks: [{
          type: 'table',
          id: 'providers-table',
          columns: [
            { key: 'name', label: '名称' }, { key: 'server', label: 'EA' }, { key: 'route', label: '线路套餐' },
            { key: 'status', label: '状态' }, { key: 'accounts', label: '账号' }, { key: 'endpoint', label: '接入路径' },
          ],
          rows: providers.map((provider) => ({
            name: provider.name,
            server: provider.server.name,
            route: provider.routePackage?.name || '服务器默认',
            status: `${!provider.enabled ? '已停用' : provider.health?.state === 'online' ? `在线${provider.health.latencyMs != null ? ` · ${provider.health.latencyMs}ms` : ''}` : provider.health?.state === 'offline' ? `离线 · ${provider.health.message || '健康检查失败'}` : `配置异常 · ${provider.health?.message || '无法检查 EA'}`}${provider.reconcileStatus?.running ? ` · 对账 ${provider.reconcileStatus.progress ?? 0}%` : ''}`,
            accounts: Object.values(provider.accountCounts || {}).reduce((sum, value) => sum + Number(value || 0), 0),
            endpoint: `/api/external/emby/${provider.slug}`,
          })),
        }],
      },
      {
        id: 'accounts',
        title: `账号映射 · 第 ${accountPage.page}/${Math.max(1, accountPage.totalPages)} 页 · 共 ${accountPage.total} 条`,
        blocks: [{
          type: 'table',
          id: 'accounts-table',
          columns: [
            { key: 'name', label: '外部身份' }, { key: 'provider', label: '接入' }, { key: 'status', label: '状态' },
            { key: 'eaId', label: 'EA 用户 ID' }, { key: 'syncedAt', label: '最近同步' }, { key: 'error', label: '异常' },
          ],
          rows: accounts.map((account) => ({
            name: account.externalName,
            provider: account.provider.name,
            status: account.state,
            eaId: account.embyUser?.embyId || '—',
            syncedAt: account.lastSyncAt || '—',
            error: account.failureReason || '—',
          })),
        }, ...accountNavigation],
      },
      {
        id: 'audits',
        title: `审计 · 第 ${auditPage.page}/${Math.max(1, auditPage.totalPages)} 页 · 共 ${auditPage.total} 条`,
        blocks: [{
          type: 'table',
          id: 'audits-table',
          columns: [
            { key: 'time', label: '时间' }, { key: 'provider', label: '接入' }, { key: 'account', label: '账号' },
            { key: 'action', label: '动作' }, { key: 'outcome', label: '结果' }, { key: 'ip', label: '来源 IP' },
          ],
          rows: audits.map((audit) => ({
            time: audit.createdAt,
            provider: audit.provider.name,
            account: audit.account?.externalName || '—',
            action: audit.action,
            outcome: audit.outcome,
            ip: audit.ip || '—',
          })),
        }, ...auditNavigation],
      },
      ...(adapter ? [{
        id: 'instructions',
        title: 'Fabric 配置说明',
        blocks: [{ type: 'text', id: 'config-hint', title: adapter.name, tone: 'info', content: `${adapter.description || ''}\n\n${adapter.configHint || ''}\n${adapter.addressHint || ''}` }],
      }] : []),
    ],
  }
}

export const adminActions = {
  'load-admin': async (input: unknown, ctx: PluginContext) => ({ page: await page(ctx, undefined, undefined, input) }),
  'create-provider': async (input: unknown, ctx: PluginContext) => {
    const form = input as Record<string, unknown>
    const [serverId, routePackageId = ''] = text(form.target, 'target').split('::')
    const result = await ctx.externalAccountsAdmin.createProvider({
      name: text(form.name, 'name', 80),
      adapterId: 'fabric',
      serverId: text(serverId, 'serverId'),
      routePackageId: routePackageId ? Number(routePackageId) : null,
    })
    return {
      message: '已创建 Fabric 接入，请立即保存一次性密钥。',
      page: await page(ctx, { title: '接入已创建', content: '下方密钥只显示这一次。', tone: 'success' }, result),
    }
  },
  'manage-provider': async (input: unknown, ctx: PluginContext) => {
    const form = input as Record<string, unknown>
    const providerId = text(form.providerId, 'providerId')
    const operation = text(form.operation, 'operation', 32)
    let message = '操作已完成'
    let noticeTone: 'success' | 'warning' = 'success'
    let oneTimeSecret: { provider: ExternalAccountAdminProvider; secret: string } | undefined
    if (operation === 'enable') await ctx.externalAccountsAdmin.updateProvider(providerId, { enabled: true })
    else if (operation === 'disable') await ctx.externalAccountsAdmin.updateProvider(providerId, { enabled: false })
    else if (operation === 'reconcile') {
      const result = await ctx.externalAccountsAdmin.reconcileProvider(providerId)
      message = result.running
        ? `全量对账已在后台启动${result.coalesced ? '（已有任务，未重复执行）' : ''}。可点击“刷新数据”查看实时进度；离开本页不会中断。`
        : `对账完成：${result.progress ?? 100}%（${result.completed ?? result.checked}/${result.checked}），同步 ${result.repaired}，失败 ${result.failed}，重试 ${result.retried ?? 0} 次，其中限流 ${result.rateLimited ?? 0} 次${result.durationMs != null ? `，耗时 ${Math.round(result.durationMs / 1000)} 秒` : ''}`
      const diagnostics = result.errors?.slice(0, 3).map((item) => `${item.id}: ${item.message.slice(0, 180)}`) || []
      if (diagnostics.length) message += `\n失败示例：\n${diagnostics.join('\n')}`
      if (!result.running && result.failed) noticeTone = 'warning'
    } else if (operation === 'rotate-secret') {
      oneTimeSecret = await ctx.externalAccountsAdmin.rotateProviderSecret(providerId)
      message = '密钥已轮换，旧密钥立即失效'
    } else if (operation === 'delete') await ctx.externalAccountsAdmin.deleteProvider(providerId)
    else throw new Error('不支持的接入操作')
    return { message, page: await page(ctx, { title: noticeTone === 'warning' ? '操作部分完成' : '操作完成', content: message, tone: noticeTone }, oneTimeSecret) }
  },
  'manage-account': async (input: unknown, ctx: PluginContext) => {
    const form = input as Record<string, unknown>
    const [providerId, accountId] = text(form.account, 'account').split('::')
    const operation = text(form.operation, 'operation', 32)
    if (!providerId || !accountId) throw new Error('账号参数无效')
    if (operation === 'reconcile') await ctx.externalAccountsAdmin.reconcileAccount(providerId, accountId)
    else if (operation === 'delete') await ctx.externalAccountsAdmin.deleteAccount(providerId, accountId)
    else throw new Error('不支持的账号操作')
    return { message: '账号操作已完成', page: await page(ctx, { title: '账号操作完成', content: '数据已重新读取。', tone: 'success' }) }
  },
}
