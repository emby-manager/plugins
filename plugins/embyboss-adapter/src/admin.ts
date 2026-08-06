import type {
  ExternalAccountAdminAccount,
  ExternalAccountAdminProvider,
  PluginContext,
} from '@emby-manager/plugin-sdk'

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

async function dashboard(
  ctx: PluginContext,
  message?: string,
  oneTimeSecret?: { provider: ExternalAccountAdminProvider; secret: string },
) {
  const [options, providers, accounts, audits] = await Promise.all([
    ctx.externalAccountsAdmin.getOptions(),
    ctx.externalAccountsAdmin.listProviders(),
    ctx.externalAccountsAdmin.listAccounts(),
    ctx.externalAccountsAdmin.listAudits(),
  ])
  const adapter = options.adapters.find((item) => item.id === 'embyboss')
  const targets = options.servers.flatMap((server) => {
    if (!server.ready) return []
    if (!server.routePackages.length) return [{ label: `${server.name} · 服务器默认线路`, value: `${server.id}::` }]
    return server.routePackages.map((item) => ({ label: `${server.name} · ${item.name}`, value: `${server.id}::${item.id}` }))
  }).slice(0, 50)
  const active = accounts.filter((item) => item.state === 'ACTIVE').length
  const issues = accounts.filter((item) => ['FAILED', 'PENDING', 'DELETE_PENDING'].includes(item.state)).length
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
    accounts: accounts.map((account) => ({
      id: account.id,
      providerId: account.provider.id,
      externalName: account.externalName,
      state: account.state,
      lastSyncAt: account.lastSyncAt,
      failureReason: account.failureReason?.slice(0, 500) || null,
    })),
  })

  return {
    version: 1,
    title: 'EmbyBoss 外部账号接入',
    description: '页面和业务编排由 EmbyBoss 适配器插件自带，EM 只执行已批准的细分安全能力。',
    sections: [
      {
        id: 'overview', columns: 3, blocks: [
          { type: 'metric', id: 'provider-count', title: '接入数', value: providers.length },
          { type: 'metric', id: 'active-count', title: '正常账号', value: active },
          { type: 'metric', id: 'issue-count', title: '待处理', value: issues },
        ],
      },
      ...(message ? [{ id: 'notice', blocks: [{ type: 'text', id: 'notice-text', title: '操作完成', content: message, tone: 'success' }] }] : []),
      ...(oneTimeSecret ? [{ id: 'secret', blocks: [{
        type: 'text', id: 'one-time-secret', title: '密钥只显示这一次', tone: 'warning',
        content: `接入基地址：/api/external/emby/${oneTimeSecret.provider.slug}\nEmby API 密钥：${oneTimeSecret.secret}\n\n在 EmbyBoss 中填入当前 EM 站点域名 + 上述路径。EmbyBoss 会自动追加 /emby，这里不要再添加。`,
      }] }] : []),
      {
        id: 'create', title: '创建 EmbyBoss 接入',
        description: '接入标识、隐藏账号映射和密钥均由安全代理生成。',
        blocks: targets.length ? [{
          type: 'form', id: 'create-provider', action: 'create-provider', submitLabel: '创建并生成密钥',
          fields: [
            { name: 'name', label: '接入名称', type: 'text', required: true, placeholder: '例如：EmbyBoss 公益服' },
            { name: 'target', label: '目标 EA 与默认线路', type: 'select', required: true, options: targets },
          ],
        }] : [{ type: 'text', id: 'no-ea', title: '暂无可用 EA', content: '请先在服务器管理中配置 EA 和 Webhook 密钥。', tone: 'warning' }],
      },
      ...(providers.length ? [{ id: 'provider-actions', title: '接入操作', columns: 2, blocks: [{
        type: 'form', id: 'manage-provider', action: 'manage-provider', submitLabel: '执行接入操作', fields: [
          { name: 'providerId', label: '接入', type: 'select', required: true, options: providerOptions(providers) },
          { name: 'operation', label: '操作', type: 'select', required: true, options: [
            { label: '启用', value: 'enable' }, { label: '停用', value: 'disable' },
            { label: '全量对账', value: 'reconcile' }, { label: '轮换密钥', value: 'rotate-secret' },
            { label: '删除空接入', value: 'delete' },
          ] },
        ],
      }, { type: 'action', id: 'refresh', title: '刷新数据', action: 'load-admin', variant: 'outline' }] }] : []),
      ...(accounts.some((item) => item.state !== 'DELETED') ? [{ id: 'account-actions', title: '账号操作', blocks: [{
        type: 'form', id: 'manage-account', action: 'manage-account', submitLabel: '执行账号操作', fields: [
          { name: 'account', label: '外部账号', type: 'select', required: true, options: accountOptions(accounts) },
          { name: 'operation', label: '操作', type: 'select', required: true, options: [
            { label: '重新同步到 EA', value: 'reconcile' }, { label: '从 EA 删除并保留审计', value: 'delete' },
          ] },
        ],
      }] }] : []),
      { id: 'providers', title: '已配置接入', blocks: [{
        type: 'table', id: 'providers-table',
        columns: [
          { key: 'name', label: '名称' }, { key: 'server', label: 'EA' }, { key: 'route', label: '线路套餐' },
          { key: 'status', label: '状态' }, { key: 'accounts', label: '账号' }, { key: 'endpoint', label: '接入路径' },
        ],
        rows: providers.map((item) => ({
          name: item.name, server: item.server.name, route: item.routePackage?.name || '服务器默认',
          status: item.enabled ? '运行中' : '已停用',
          accounts: Object.values(item.accountCounts || {}).reduce((sum, value) => sum + Number(value || 0), 0),
          endpoint: `/api/external/emby/${item.slug}`,
        })),
      }] },
      { id: 'accounts', title: '账号映射', blocks: [{
        type: 'table', id: 'accounts-table',
        columns: [
          { key: 'name', label: '外部身份' }, { key: 'provider', label: '接入' }, { key: 'status', label: '状态' },
          { key: 'eaId', label: 'EA 用户 ID' }, { key: 'syncedAt', label: '最近同步' }, { key: 'error', label: '异常' },
        ],
        rows: accounts.slice(0, 200).map((item) => ({
          name: item.externalName, provider: item.provider.name, status: item.state,
          eaId: item.embyUser?.embyId || '—', syncedAt: item.lastSyncAt || '—', error: item.failureReason || '—',
        })),
      }] },
      { id: 'audits', title: '审计', blocks: [{
        type: 'table', id: 'audits-table',
        columns: [
          { key: 'time', label: '时间' }, { key: 'provider', label: '接入' }, { key: 'account', label: '账号' },
          { key: 'action', label: '动作' }, { key: 'outcome', label: '结果' }, { key: 'ip', label: '来源 IP' },
        ],
        rows: audits.slice(0, 200).map((item) => ({
          time: item.createdAt, provider: item.provider.name, account: item.account?.externalName || '—',
          action: item.action, outcome: item.outcome, ip: item.ip || '—',
        })),
      }] },
      ...(adapter ? [{ id: 'instructions', title: 'EmbyBoss 配置说明', blocks: [{
        type: 'text', id: 'config-hint', title: adapter.name, tone: 'info',
        content: `${adapter.description || ''}\n\n${adapter.configHint || ''}\n${adapter.addressHint || ''}`,
      }] }] : []),
    ],
  }
}

export const adminActions = {
  'load-admin': async (_input: unknown, ctx: PluginContext) => ({ page: await dashboard(ctx) }),
  'create-provider': async (input: unknown, ctx: PluginContext) => {
    const form = input as Record<string, unknown>
    const [serverId, routePackageId = ''] = required(form.target, 'target').split('::')
    const result = await ctx.externalAccountsAdmin.createProvider({
      name: required(form.name, 'name', 80), adapterId: 'embyboss', serverId: required(serverId, 'serverId'),
      routePackageId: routePackageId ? Number(routePackageId) : null,
    })
    return { message: '接入已创建', page: await dashboard(ctx, '接入已创建，请立即保存一次性密钥。', result) }
  },
  'manage-provider': async (input: unknown, ctx: PluginContext) => {
    const form = input as Record<string, unknown>
    const id = required(form.providerId, 'providerId')
    const operation = required(form.operation, 'operation', 32)
    let message = '操作已完成'
    let secret: { provider: ExternalAccountAdminProvider; secret: string } | undefined
    if (operation === 'enable') await ctx.externalAccountsAdmin.updateProvider(id, { enabled: true })
    else if (operation === 'disable') await ctx.externalAccountsAdmin.updateProvider(id, { enabled: false })
    else if (operation === 'reconcile') {
      const result = await ctx.externalAccountsAdmin.reconcileProvider(id)
      message = `对账完成：检查 ${result.checked}，同步 ${result.repaired}，失败 ${result.failed}`
    } else if (operation === 'rotate-secret') secret = await ctx.externalAccountsAdmin.rotateProviderSecret(id)
    else if (operation === 'delete') await ctx.externalAccountsAdmin.deleteProvider(id)
    else throw new Error('不支持的接入操作')
    return { message, page: await dashboard(ctx, message, secret) }
  },
  'manage-account': async (input: unknown, ctx: PluginContext) => {
    const form = input as Record<string, unknown>
    const [providerId, accountId] = required(form.account, 'account').split('::')
    const operation = required(form.operation, 'operation', 32)
    if (!providerId || !accountId) throw new Error('账号参数无效')
    if (operation === 'reconcile') await ctx.externalAccountsAdmin.reconcileAccount(providerId, accountId)
    else if (operation === 'delete') await ctx.externalAccountsAdmin.deleteAccount(providerId, accountId)
    else throw new Error('不支持的账号操作')
    return { message: '账号操作已完成', page: await dashboard(ctx, '账号操作已完成。') }
  },
}
