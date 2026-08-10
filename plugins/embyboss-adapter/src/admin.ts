import type {
  ExternalAccountAdminAccount,
  ExternalAccountAdminAudit,
  ExternalAccountAdminPageCompat,
  ExternalAccountAdminProvider,
  PluginContext,
} from '@emby-manager/plugin-sdk'

type AdminView = 'overview' | 'create' | 'provider' | 'accounts' | 'audits' | 'help'

interface DashboardFilters {
  view: AdminView
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

function optionalText(value: unknown, max = 100): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function isAdminView(value: string): value is AdminView {
  return value === 'overview' || value === 'create' || value === 'provider'
    || value === 'accounts' || value === 'audits' || value === 'help'
}

function dashboardFilters(value: unknown): DashboardFilters {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const requestedView = optionalText(input.view, 24)
  const providerId = optionalText(input.providerId, 191)
  return {
    view: isAdminView(requestedView) ? requestedView : 'overview',
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
    view: value.view,
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

function required(value: unknown, name: string, max = 191): string {
  const result = typeof value === 'string' ? value.trim() : ''
  if (!result || result.length > max) throw new Error(`${name} 参数无效`)
  return result
}

function providerOptions(providers: ExternalAccountAdminProvider[]) {
  return providers.slice(0, 50).map((item) => ({ label: `${item.name} · ${item.server.name}`, value: item.id }))
}

function accountOptions(accounts: ExternalAccountAdminAccount[]) {
  return accounts.filter((item) => item.state !== 'DELETED').slice(0, 50).map((item) => ({
    label: `${item.externalName} · ${item.provider.name} · ${item.state}`,
    value: `${item.provider.id}::${item.id}`,
  }))
}

function accountTotal(provider: ExternalAccountAdminProvider): number {
  return Object.values(provider.accountCounts || {}).reduce((sum, value) => sum + Number(value || 0), 0)
}

function pendingTotal(provider: ExternalAccountAdminProvider): number {
  return Number(provider.accountCounts?.PENDING || 0)
    + Number(provider.accountCounts?.FAILED || 0)
    + Number(provider.accountCounts?.DELETE_PENDING || 0)
}

function activeTotal(providers: ExternalAccountAdminProvider[]): number {
  return providers.reduce((sum, item) => sum + Number(item.accountCounts?.ACTIVE || 0), 0)
}

function issueTotal(providers: ExternalAccountAdminProvider[]): number {
  return providers.reduce((sum, item) => sum + pendingTotal(item), 0)
}

function providerStatus(provider: ExternalAccountAdminProvider): string {
  if (!provider.enabled) return '已停用'
  if (provider.health?.state === 'online') {
    return `在线${provider.health.latencyMs != null ? ` · ${provider.health.latencyMs}ms` : ''}`
  }
  if (provider.health?.state === 'offline') return `离线 · ${provider.health.message || '健康检查失败'}`
  return `配置异常 · ${provider.health?.message || '无法检查 EA'}`
}

function targetOptions(options: Awaited<ReturnType<PluginContext['externalAccountsAdmin']['getOptions']>>) {
  return options.servers.flatMap((server) => {
    if (!server.ready) return []
    if (!server.routePackages.length) return [{ label: `${server.name} · 服务器默认线路`, value: `${server.id}::` }]
    return server.routePackages.map((item) => ({ label: `${server.name} · ${item.name}`, value: `${server.id}::${item.id}` }))
  }).slice(0, 50)
}

function routeAction(
  id: string,
  title: string,
  action: string,
  filters: DashboardFilters,
  view: AdminView,
  variant: 'primary' | 'outline' = 'outline',
) {
  return { type: 'action', id, title, action, variant, input: navigationInput(filters, { view }) }
}

function toolbar(filters: DashboardFilters) {
  return {
    id: 'toolbar',
    columns: 6,
    blocks: [
      routeAction('go-overview', '接入总览', 'load-admin', filters, 'overview'),
      routeAction('go-create', '创建接入', 'load-admin', filters, 'create', 'primary'),
      routeAction('go-provider', '接入管理', 'load-admin', filters, 'provider'),
      routeAction('go-accounts', '账号管理', 'load-accounts', filters, 'accounts'),
      routeAction('go-audits', '审计记录', 'load-audits', filters, 'audits'),
      routeAction('refresh', '刷新', 'load-admin', filters, filters.view),
    ],
  }
}

function noticeSection(message: string | undefined, tone: 'success' | 'warning') {
  return message ? [{
    id: 'notice',
    blocks: [{ type: 'text', id: 'notice-text', title: tone === 'warning' ? '操作部分完成' : '操作完成', content: message, tone }],
  }] : []
}

function secretSection(oneTimeSecret: { provider: ExternalAccountAdminProvider; secret: string } | undefined) {
  return oneTimeSecret ? [{
    id: 'secret',
    blocks: [{
      type: 'text',
      id: 'one-time-secret',
      title: '密钥只显示这一次',
      tone: 'warning',
      content: `接入基地址：/api/external/emby/${oneTimeSecret.provider.slug}\nEmby API 密钥：${oneTimeSecret.secret}\n\n请立即复制到 EmbyBoss 配置。关闭或刷新后只能重新生成新密钥；EmbyBoss 会自动追加 /emby，这里不要再添加。`,
    }],
  }] : []
}

function reconciliationSection(provider: ExternalAccountAdminProvider | undefined) {
  const status = provider?.reconcileStatus
  if (!provider || !status) return []
  const headline = status.running
    ? `进行中 ${status.progress ?? 0}%（已检查 ${status.checked}，已完成 ${status.completed ?? 0}），已修复 ${status.repaired}，失败 ${status.failed}，重试 ${status.retried ?? 0}`
    : `最近一次任务：已检查 ${status.checked}，已修复 ${status.repaired}，失败 ${status.failed}，重试 ${status.retried ?? 0}${status.durationMs != null ? `，耗时 ${Math.round(status.durationMs / 1000)} 秒` : ''}`
  const errors = status.errors?.slice(0, 3).map((item) => `- ${item.id}: ${item.message.slice(0, 180)}`) || []
  return [{
    id: 'reconcile-progress',
    blocks: [{
      type: 'text',
      id: 'reconcile-progress-text',
      title: '检查并修复账号状态进度',
      content: [headline, ...errors].join('\n'),
      tone: !status.running && status.failed ? 'warning' : 'info',
    }],
  }]
}

async function dashboard(
  ctx: PluginContext,
  message?: string,
  oneTimeSecret?: { provider: ExternalAccountAdminProvider; secret: string },
  requestedFilters?: unknown,
  messageTone: 'success' | 'warning' = 'success',
) {
  const filters = dashboardFilters(requestedFilters)
  const needOptions = filters.view === 'create' || filters.view === 'help'
  const needProviders = filters.view !== 'help'
  const needAccounts = filters.view === 'accounts'
  const needAudits = filters.view === 'audits'
  const [optionsResult, providers, accountResult, auditResult] = await Promise.all([
    needOptions ? ctx.externalAccountsAdmin.getOptions() : Promise.resolve(undefined),
    needProviders ? ctx.externalAccountsAdmin.listProviders() : Promise.resolve([]),
    needAccounts ? ctx.externalAccountsAdmin.listAccounts({
      providerId: filters.providerId || undefined,
      state: filters.accountState,
      search: filters.accountSearch || undefined,
      page: filters.accountPage,
      pageSize: filters.pageSize,
    }) : Promise.resolve(undefined),
    needAudits ? ctx.externalAccountsAdmin.listAudits({
      providerId: filters.providerId || undefined,
      outcome: filters.auditOutcome,
      search: filters.auditSearch || undefined,
      page: filters.auditPage,
      pageSize: filters.pageSize,
    }) : Promise.resolve(undefined),
  ])
  const options = optionsResult || { servers: [], adapters: [] }
  const accountPage = normalizePage<ExternalAccountAdminAccount>(accountResult || [], filters.accountPage, filters.pageSize)
  const auditPage = normalizePage<ExternalAccountAdminAudit>(auditResult || [], filters.auditPage, filters.pageSize)
  const accounts = accountPage.items
  const audits = auditPage.items
  const adapter = options.adapters.find((item) => item.id === 'embyboss')

  const state: Record<string, unknown> = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    view: filters.view,
    providers: providers.map((provider) => ({
      id: provider.id,
      name: provider.name,
      adapterId: provider.adapterId,
      serverId: provider.server.id,
      routePackageId: provider.routePackageId,
      enabled: provider.enabled,
    })),
  }
  if (filters.view === 'accounts') {
    state.accountPage = { total: accountPage.total, page: accountPage.page, pageSize: accountPage.pageSize }
    state.accounts = accounts.map((account) => ({
      id: account.id,
      providerId: account.provider.id,
      externalName: account.externalName,
      state: account.state,
      lastSyncAt: account.lastSyncAt,
      failureReason: account.failureReason?.slice(0, 500) || null,
    }))
  }
  await ctx.storage.set('external-admin/state-v1', state)

  const providerFilterOptions = [{ label: '全部接入', value: 'ALL' }, ...providerOptions(providers)]
  const accountNavigation = [
    ...(accountPage.page > 1 ? [{
      type: 'action', id: 'accounts-previous', title: '上一页', action: 'load-accounts', variant: 'outline',
      input: navigationInput(filters, { view: 'accounts', accountPage: accountPage.page - 1 }),
    }] : []),
    ...(accountPage.page < accountPage.totalPages ? [{
      type: 'action', id: 'accounts-next', title: '下一页', action: 'load-accounts', variant: 'outline',
      input: navigationInput(filters, { view: 'accounts', accountPage: accountPage.page + 1 }),
    }] : []),
  ]
  const auditNavigation = [
    ...(auditPage.page > 1 ? [{
      type: 'action', id: 'audits-previous', title: '上一页', action: 'load-audits', variant: 'outline',
      input: navigationInput(filters, { view: 'audits', auditPage: auditPage.page - 1 }),
    }] : []),
    ...(auditPage.page < auditPage.totalPages ? [{
      type: 'action', id: 'audits-next', title: '下一页', action: 'load-audits', variant: 'outline',
      input: navigationInput(filters, { view: 'audits', auditPage: auditPage.page + 1 }),
    }] : []),
  ]

  const sections = [
    toolbar(filters),
    ...noticeSection(message, messageTone),
    ...secretSection(oneTimeSecret),
  ] as Array<Record<string, unknown>>

  if (filters.view === 'overview') {
    sections.push(
      {
        id: 'overview-status',
        columns: 3,
        blocks: [
          { type: 'metric', id: 'provider-count', title: '接入数', value: providers.length },
          { type: 'metric', id: 'active-count', title: '正常账号', value: activeTotal(providers) },
          { type: 'metric', id: 'issue-count', title: '待处理', value: issueTotal(providers) },
        ],
      },
      {
        id: 'providers',
        title: '已配置接入',
        description: '总览只显示接入和账号统计；账号明细、审计记录按需加载。',
        blocks: providers.length ? [{
          type: 'table',
          id: 'providers-table',
          columns: [
            { key: 'name', label: '接入' },
            { key: 'server', label: 'EA' },
            { key: 'status', label: '状态' },
            { key: 'accounts', label: '账号' },
            { key: 'pending', label: '待处理' },
            { key: 'manage', label: '管理' },
          ],
          rows: providers.map((provider) => ({
            name: provider.name,
            server: provider.server.name,
            status: providerStatus(provider),
            accounts: accountTotal(provider),
            pending: pendingTotal(provider),
            manage: '使用下方按钮',
          })),
        }] : [{ type: 'text', id: 'no-providers', title: '还没有接入', content: '点击右上方“创建接入”开始配置 EmbyBoss。', tone: 'info' }],
      },
      ...(providers.length ? [{
        id: 'provider-shortcuts',
        title: '管理接入',
        description: '当前宿主尚未提供表格行按钮，先从这里进入指定接入的管理页。',
        columns: 3,
        blocks: providers.slice(0, 20).map((provider, index) => ({
          type: 'action',
          id: `manage-provider-${index}`,
          title: `管理「${provider.name}」`,
          action: 'load-admin',
          variant: 'outline',
          input: navigationInput(filters, { view: 'provider', providerId: provider.id }),
        })),
      }] : []),
    )
  } else if (filters.view === 'create') {
    sections.push({
      id: 'create-page',
      title: '创建 EmbyBoss 接入',
      description: '创建后密钥只显示一次，请立即复制到 EmbyBoss。',
      blocks: oneTimeSecret ? [{
        type: 'action', id: 'return-overview-after-create', title: '返回接入总览', action: 'load-admin', variant: 'primary',
        input: navigationInput(filters, { view: 'overview', providerId: '' }),
      }] : targetOptions(options).length ? [{
        type: 'form',
        id: 'create-provider',
        action: 'create-provider',
        submitLabel: '创建并生成密钥',
        fields: [
          { name: 'name', label: '接入名称', type: 'text', required: true, placeholder: '例如：EmbyBoss 公益服' },
          { name: 'target', label: '目标 EA 与默认线路', type: 'select', required: true, options: targetOptions(options) },
        ],
      }] : [{ type: 'text', id: 'no-ea', title: '暂无可用 EA', content: '请先在服务器管理中配置 EA 和线路。', tone: 'warning' }],
    })
  } else if (filters.view === 'provider') {
    const selectedProvider = providers.find((provider) => provider.id === filters.providerId) || providers[0]
    if (!selectedProvider) {
      sections.push({ id: 'provider-empty', blocks: [{ type: 'text', id: 'no-provider', title: '没有可管理的接入', content: '请先创建一个 EmbyBoss 接入。', tone: 'warning' }] })
    } else {
      const toggle = selectedProvider.enabled
        ? { title: '停用接入', operation: 'disable', confirm: `确定停用「${selectedProvider.name}」吗？停用后新请求将不再通过该接入。` }
        : { title: '启用接入', operation: 'enable', confirm: `确定启用「${selectedProvider.name}」吗？` }
      sections.push(
        {
          id: 'provider-summary',
          columns: 3,
          blocks: [
            { type: 'metric', id: 'provider-health', title: '当前状态', value: providerStatus(selectedProvider) },
            { type: 'metric', id: 'provider-accounts', title: '账号数', value: accountTotal(selectedProvider) },
            { type: 'metric', id: 'provider-pending', title: '待处理', value: pendingTotal(selectedProvider) },
          ],
        },
        {
          id: 'provider-info',
          blocks: [{
            type: 'text',
            id: 'provider-details',
            title: selectedProvider.name,
            content: `EA：${selectedProvider.server.name}\n线路：${selectedProvider.routePackage?.name || '服务器默认'}\n接入路径：/api/external/emby/${selectedProvider.slug}`,
            tone: 'info',
          }],
        },
        {
          id: 'provider-actions',
          title: '接入操作',
          columns: 3,
          blocks: [
            { type: 'action', id: 'provider-toggle', title: toggle.title, action: 'manage-provider', variant: 'primary', input: { providerId: selectedProvider.id, operation: toggle.operation }, confirm: toggle.confirm },
            { type: 'action', id: 'rotate-provider-secret', title: '重新生成接入密钥', action: 'manage-provider', variant: 'outline', input: { providerId: selectedProvider.id, operation: 'rotate-secret' }, confirm: '重新生成后旧密钥会立即失效，确定继续吗？' },
          ],
        },
        {
          id: 'provider-maintenance',
          title: '维护',
          description: '核对该接入的 EM 账号、EA 用户和线路状态，并修复发现的不一致。任务会在后台运行，可能产生较多 EA 请求；日常无需执行。',
          blocks: [{
            type: 'action',
            id: 'reconcile-provider',
            title: '检查并修复账号状态',
            action: 'manage-provider',
            variant: 'outline',
            input: { providerId: selectedProvider.id, operation: 'reconcile' },
            confirm: '这项维护会核对并修复该接入的账号状态，可能产生较多 EA 请求。确定继续吗？',
          }],
        },
        ...reconciliationSection(selectedProvider),
        {
          id: 'provider-linked-views',
          title: '查看数据',
          columns: 2,
          blocks: [
            routeAction('provider-accounts', '查看该接入的账号', 'load-accounts', filters, 'accounts'),
            routeAction('provider-audits', '查看该接入的审计', 'load-audits', filters, 'audits'),
          ],
        },
      )
    }
  } else if (filters.view === 'accounts') {
    sections.push({
      id: 'accounts-view',
      title: `账号管理 · 第 ${accountPage.page}/${Math.max(1, accountPage.totalPages)} 页 · 共 ${accountPage.total} 条`,
      description: '只有进入账号管理时才读取账号分页；翻页会保留当前筛选条件。',
      blocks: [
        {
          type: 'form',
          id: 'account-filters',
          action: 'load-accounts',
          submitLabel: '应用筛选',
          fields: [
            { name: 'providerId', label: '接入', type: 'select', defaultValue: filters.providerId || 'ALL', options: providerFilterOptions },
            { name: 'accountState', label: '账号状态', type: 'select', defaultValue: filters.accountState, options: [
              { label: '全部状态', value: 'ALL' }, { label: '正常', value: 'ACTIVE' }, { label: '待同步', value: 'PENDING' },
              { label: '失败', value: 'FAILED' }, { label: '已停用', value: 'DISABLED' }, { label: '待删除', value: 'DELETE_PENDING' }, { label: '已删除', value: 'DELETED' },
            ] },
            { name: 'accountSearch', label: '搜索账号', type: 'text', defaultValue: filters.accountSearch, placeholder: '外部身份或 EM 内部用户名' },
            { name: 'pageSize', label: '每页条数', type: 'select', defaultValue: String(filters.pageSize), options: [
              { label: '每页 10 条', value: '10' }, { label: '每页 25 条', value: '25' }, { label: '每页 50 条', value: '50' }, { label: '每页 100 条', value: '100' },
            ] },
          ],
        },
        ...(accounts.some((item) => item.state !== 'DELETED') ? [{
          type: 'form', id: 'manage-account', action: 'manage-account', submitLabel: '执行账号操作', fields: [
            { name: 'account', label: '外部账号', type: 'select', required: true, options: accountOptions(accounts) },
            { name: 'operation', label: '操作', type: 'select', required: true, options: [
              { label: '重新同步到 EA', value: 'reconcile' }, { label: '从 EA 删除并保留审计', value: 'delete' },
            ] },
          ],
        }] : []),
        {
          type: 'table', id: 'accounts-table', columns: [
            { key: 'name', label: '外部身份' }, { key: 'provider', label: '接入' }, { key: 'status', label: '状态' },
            { key: 'eaId', label: 'EA 用户 ID' }, { key: 'syncedAt', label: '最近同步' }, { key: 'error', label: '异常' },
          ],
          rows: accounts.map((item) => ({
            name: item.externalName, provider: item.provider.name, status: item.state,
            eaId: item.embyUser?.embyId || '—', syncedAt: item.lastSyncAt || '—', error: item.failureReason || '—',
          })),
        },
        ...accountNavigation,
      ],
    })
  } else if (filters.view === 'audits') {
    sections.push({
      id: 'audits-view',
      title: `审计记录 · 第 ${auditPage.page}/${Math.max(1, auditPage.totalPages)} 页 · 共 ${auditPage.total} 条`,
      description: '只有进入审计记录时才读取审计分页；翻页会保留当前筛选条件。',
      blocks: [
        {
          type: 'form',
          id: 'audit-filters',
          action: 'load-audits',
          submitLabel: '应用筛选',
          fields: [
            { name: 'providerId', label: '接入', type: 'select', defaultValue: filters.providerId || 'ALL', options: providerFilterOptions },
            { name: 'auditOutcome', label: '审计结果', type: 'select', defaultValue: filters.auditOutcome, options: [
              { label: '全部结果', value: 'ALL' }, { label: '成功', value: 'success' }, { label: '失败', value: 'failed' },
              { label: '部分成功', value: 'partial' }, { label: '重试中', value: 'retrying' },
            ] },
            { name: 'auditSearch', label: '搜索动作 / 账号 / IP', type: 'text', defaultValue: filters.auditSearch, placeholder: '动作、账号、接入、请求 ID 或 IP' },
            { name: 'pageSize', label: '每页条数', type: 'select', defaultValue: String(filters.pageSize), options: [
              { label: '每页 10 条', value: '10' }, { label: '每页 25 条', value: '25' }, { label: '每页 50 条', value: '50' }, { label: '每页 100 条', value: '100' },
            ] },
          ],
        },
        {
          type: 'table', id: 'audits-table', columns: [
            { key: 'time', label: '时间' }, { key: 'provider', label: '接入' }, { key: 'account', label: '账号' },
            { key: 'action', label: '动作' }, { key: 'outcome', label: '结果' }, { key: 'ip', label: '来源 IP' },
          ],
          rows: audits.map((item) => ({
            time: item.createdAt, provider: item.provider.name, account: item.account?.externalName || '—',
            action: item.action, outcome: item.outcome, ip: item.ip || '—',
          })),
        },
        ...auditNavigation,
      ],
    })
  } else if (filters.view === 'help') {
    sections.push({
      id: 'instructions',
      title: '配置说明',
      blocks: [{
        type: 'text',
        id: 'config-hint',
        title: adapter?.name || 'EmbyBoss',
        tone: 'info',
        content: adapter ? `${adapter.description || ''}\n\n${adapter.configHint || ''}\n${adapter.addressHint || ''}` : '当前宿主没有返回 EmbyBoss 配置说明。',
      }],
    })
  }

  if (filters.view !== 'help') {
    sections.push({
      id: 'help-link',
      blocks: [routeAction('go-help', '查看配置说明', 'load-admin', filters, 'help')],
    })
  }

  return {
    version: 1,
    title: 'EmbyBoss 接入总览',
    description: '按接入管理 EA 账号、线路和同步状态。',
    sections,
  }
}

export const adminActions = {
  'load-admin': async (input: unknown, ctx: PluginContext) => ({ page: await dashboard(ctx, undefined, undefined, input) }),
  'load-accounts': async (input: unknown, ctx: PluginContext) => ({
    page: await dashboard(ctx, undefined, undefined, { ...(input as Record<string, unknown> || {}), view: 'accounts' }),
  }),
  'load-audits': async (input: unknown, ctx: PluginContext) => ({
    page: await dashboard(ctx, undefined, undefined, { ...(input as Record<string, unknown> || {}), view: 'audits' }),
  }),
  'create-provider': async (input: unknown, ctx: PluginContext) => {
    const form = input as Record<string, unknown>
    const [serverId, routePackageId = ''] = required(form.target, 'target').split('::')
    const result = await ctx.externalAccountsAdmin.createProvider({
      name: required(form.name, 'name', 80), adapterId: 'embyboss', serverId: required(serverId, 'serverId'),
      routePackageId: routePackageId ? Number(routePackageId) : null,
    })
    return { message: '接入已创建', page: await dashboard(ctx, '接入已创建，请立即保存一次性密钥。', result, { view: 'create' }) }
  },
  'manage-provider': async (input: unknown, ctx: PluginContext) => {
    const form = input as Record<string, unknown>
    const id = required(form.providerId, 'providerId')
    const operation = required(form.operation, 'operation', 32)
    let message = '操作已完成'
    let messageTone: 'success' | 'warning' = 'success'
    let secret: { provider: ExternalAccountAdminProvider; secret: string } | undefined
    if (operation === 'enable') await ctx.externalAccountsAdmin.updateProvider(id, { enabled: true })
    else if (operation === 'disable') await ctx.externalAccountsAdmin.updateProvider(id, { enabled: false })
    else if (operation === 'reconcile') {
      const result = await ctx.externalAccountsAdmin.reconcileProvider(id)
      message = result.running
        ? `检查并修复账号状态已在后台启动${result.coalesced ? '（已有任务，未重复执行）' : ''}。可点击“刷新”查看进度；离开本页不会中断。`
        : `检查完成：${result.progress ?? 100}%（${result.completed ?? result.checked}/${result.checked}），已修复 ${result.repaired}，失败 ${result.failed}，重试 ${result.retried ?? 0} 次，其中限流 ${result.rateLimited ?? 0} 次${result.durationMs != null ? `，耗时 ${Math.round(result.durationMs / 1000)} 秒` : ''}`
      const diagnostics = result.errors?.slice(0, 3).map((item) => `${item.id}: ${item.message.slice(0, 180)}`) || []
      if (diagnostics.length) message += `\n失败示例：\n${diagnostics.join('\n')}`
      if (!result.running && result.failed) messageTone = 'warning'
    } else if (operation === 'rotate-secret') {
      secret = await ctx.externalAccountsAdmin.rotateProviderSecret(id)
    } else if (operation === 'delete') {
      // Retained for compatibility with older cached pages; intentionally not rendered by this UI.
      await ctx.externalAccountsAdmin.deleteProvider(id)
    } else throw new Error('不支持的接入操作')
    const view = operation === 'delete' ? 'overview' : 'provider'
    return { message, page: await dashboard(ctx, message, secret, { view, providerId: view === 'provider' ? id : '' }, messageTone) }
  },
  'manage-account': async (input: unknown, ctx: PluginContext) => {
    const form = input as Record<string, unknown>
    const [providerId, accountId] = required(form.account, 'account').split('::')
    const operation = required(form.operation, 'operation', 32)
    if (!providerId || !accountId) throw new Error('账号参数无效')
    if (operation === 'reconcile') await ctx.externalAccountsAdmin.reconcileAccount(providerId, accountId)
    else if (operation === 'delete') await ctx.externalAccountsAdmin.deleteAccount(providerId, accountId)
    else throw new Error('不支持的账号操作')
    return { message: '账号操作已完成', page: await dashboard(ctx, '账号操作已完成。', undefined, { view: 'accounts', providerId }) }
  },
}
