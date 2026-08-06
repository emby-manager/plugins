import type {
  ExternalAccountAdminAccount,
  ExternalAccountAdminProvider,
  PluginContext,
} from '@emby-manager/plugin-sdk'

type AdminNotice = { title: string; content: string; tone?: 'info' | 'success' | 'warning' | 'danger' }

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
) {
  const [options, providers, accounts, audits] = await Promise.all([
    ctx.externalAccountsAdmin.getOptions(),
    ctx.externalAccountsAdmin.listProviders(),
    ctx.externalAccountsAdmin.listAccounts(),
    ctx.externalAccountsAdmin.listAudits(),
  ])
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
  const active = accounts.filter((account) => account.state === 'ACTIVE').length
  const issues = accounts.filter((account) => ['FAILED', 'PENDING', 'DELETE_PENDING'].includes(account.state)).length

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
            status: provider.enabled ? '运行中' : '已停用',
            accounts: Object.values(provider.accountCounts || {}).reduce((sum, value) => sum + Number(value || 0), 0),
            endpoint: `/api/external/emby/${provider.slug}`,
          })),
        }],
      },
      {
        id: 'accounts',
        title: '账号映射',
        blocks: [{
          type: 'table',
          id: 'accounts-table',
          columns: [
            { key: 'name', label: '外部身份' }, { key: 'provider', label: '接入' }, { key: 'status', label: '状态' },
            { key: 'eaId', label: 'EA 用户 ID' }, { key: 'syncedAt', label: '最近同步' }, { key: 'error', label: '异常' },
          ],
          rows: accounts.slice(0, 200).map((account) => ({
            name: account.externalName,
            provider: account.provider.name,
            status: account.state,
            eaId: account.embyUser?.embyId || '—',
            syncedAt: account.lastSyncAt || '—',
            error: account.failureReason || '—',
          })),
        }],
      },
      {
        id: 'audits',
        title: '审计',
        blocks: [{
          type: 'table',
          id: 'audits-table',
          columns: [
            { key: 'time', label: '时间' }, { key: 'provider', label: '接入' }, { key: 'account', label: '账号' },
            { key: 'action', label: '动作' }, { key: 'outcome', label: '结果' }, { key: 'ip', label: '来源 IP' },
          ],
          rows: audits.slice(0, 200).map((audit) => ({
            time: audit.createdAt,
            provider: audit.provider.name,
            account: audit.account?.externalName || '—',
            action: audit.action,
            outcome: audit.outcome,
            ip: audit.ip || '—',
          })),
        }],
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
  'load-admin': async (_input: unknown, ctx: PluginContext) => ({ page: await page(ctx) }),
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
    let oneTimeSecret: { provider: ExternalAccountAdminProvider; secret: string } | undefined
    if (operation === 'enable') await ctx.externalAccountsAdmin.updateProvider(providerId, { enabled: true })
    else if (operation === 'disable') await ctx.externalAccountsAdmin.updateProvider(providerId, { enabled: false })
    else if (operation === 'reconcile') {
      const result = await ctx.externalAccountsAdmin.reconcileProvider(providerId)
      message = `对账完成：检查 ${result.checked}，同步 ${result.repaired}，失败 ${result.failed}`
    } else if (operation === 'rotate-secret') {
      oneTimeSecret = await ctx.externalAccountsAdmin.rotateProviderSecret(providerId)
      message = '密钥已轮换，旧密钥立即失效'
    } else if (operation === 'delete') await ctx.externalAccountsAdmin.deleteProvider(providerId)
    else throw new Error('不支持的接入操作')
    return { message, page: await page(ctx, { title: '操作完成', content: message, tone: 'success' }, oneTimeSecret) }
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
