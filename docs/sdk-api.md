# Plugin SDK API 参考

Plugin V2 服务端入口通过 `definePlugin` 定义 Action、Hook、Agent Tool、事件订阅、Provider、Workflow Activity 和外部账号适配器。
每个回调都会收到 `PluginContext`；下表是 Runner 唯一允许的宿主交互面。
方法的完整 TypeScript 类型以 `@emby-manager/plugin-sdk` 导出的 `PluginContext` 为准。

```ts
import { definePlugin } from '@emby-manager/plugin-sdk'

export default definePlugin({
  async activate(ctx) {},
  actions: {
    async hello(input, ctx) { return { message: `Hello from ${ctx.plugin.id}` } },
  },
  hooks: {
    async 'schedule.cleanup'(payload, ctx) {},
  },
})
```

`activate`/`deactivate` 是安装启用与停用生命周期；`actions` 只会从宿主的插件
Action 路由触发；`hooks` 只会收到 `plugin.json.events` 已声明且由宿主投递的事件。
插件代码没有 Prisma、Express、环境变量、主程序文件系统或 Node 内置模块入口。

## 上下文通用字段

| 成员 | 用途 |
| --- | --- |
| `plugin.id/version` | 当前已验证包的标识和版本 |
| `config` | 管理员根据 `configSchema` 保存的只读快照 |
| `log.debug/info/warn/error` | 写入带插件标识的受控日志 |

## 数据、Secret 与用户

| SDK | 输入/返回 | 能力 |
| --- | --- | --- |
| `storage.get(key)` / `list(prefix?, limit?)` | 读取本插件独立 SQLite 数据；key/prefix 最长 191，limit 1–100 | `storage.kv.read` |
| `storage.set(key, value)` / `delete(key)` | 单值最大 256 KB | `storage.kv.write` |
| `secrets.get(key)` | 已废弃；当前宿主始终拒绝把 Secret 明文交给 Runner | 不可用 |
| `secrets.set(key, value)` / `delete(key)` | 密文只在本插件独立库保存 | `storage.secret.write` |
| `secrets.fetch({scope, url, ...})` | 宿主向声明主机注入 Secret 并代发请求；响应会做泄漏检测 | GET: `network.secret.use`；写方法另需 `network.write` |
| `users.getMyProfile()` / `getMyEmail()` | 当前用户资料/邮箱 | `user.*.self.read` |
| `users.getProfile(userId)` / `getEmail(userId)` | 管理员读指定用户 | `user.*.any.read` |
| `users.listDirectory({search?, limit?})` | 管理员用户目录，最多 100 条 | `user.directory.read` |

## 积分

```ts
const current = await ctx.points.getMyBalance()
const paid = await ctx.points.spend({
  amount: 10,
  reason: '兑换插件服务',
  idempotencyKey: `order:${orderId}`,
})
```

| SDK | 范围 | 能力 |
| --- | --- | --- |
| `points.getMyBalance()` | 当前用户总积分 | `points.balance.self.read` |
| `points.getBalance(userId)` | 管理员读指定用户 | `points.balance.any.read` |
| `points.spend({amount, reason, idempotencyKey})` | 当前用户原子扣款；`amount` 必须为正数 | `points.balance.self.spend` |
| `points.adjust(userId, {amount, reason, idempotencyKey})` | 管理员调整；正数增加、负数扣减 | `points.balance.any.adjust` |

金额最多两位小数，绝对值不超过 1,000,000。每次变更必须使用稳定幂等键；
不要用随机值表示同一个订单的重试。

## Emby、设备与播放会话

| SDK | 返回/说明 | 能力 |
| --- | --- | --- |
| `emby.listMyAccounts()` / `listAccounts(userId)` | 当前/指定用户 Emby 账号摘要 | `emby.account.self/any.read` |
| `emby.updateExpiry(accountId, activateTo)` | 管理员修改账号到期时间；ISO 时间最大向后十年 | `emby.account.expiry.write` |
| `emby.listMyConnections()` | 当前用户可见服务器与线路；不返回 API Key | `emby.connection.self.read` |
| `emby.listLibrary({search?, limit?})` | EM 本地媒体索引，limit 1–100 | `emby.library.read` |
| `sessions.listMySiteSessions(options?)` / `listSiteSessions(userId, options?)` | `SiteSessionSnapshot[]`；不返回 JWT | `session.site.self/any.read` |
| `sessions.revokeMySiteSession(sessionId)` / `revokeSiteSession(userId, sessionId)` | 撤销单个站点会话 | `session.site.self/any.revoke` |
| `sessions.listMyEADevices(options?)` / `listEADevices(userId, options?)` | `EADeviceSnapshot[]` | `device.ea.self/any.read` |
| `sessions.revokeMyEADevice(deviceId)` / `revokeEADevice(userId, deviceId)` | 撤销单个 EA 设备及其 Token | `device.ea.self/any.revoke` |
| `sessions.listMyPlaybackSessions(options?)` / `listPlaybackSessions(userId, options?)` | `PlaybackSessionSnapshot[]` | `playback.session.self/any.read` |
| `sessions.stopMyPlaybackSession(sessionId)` / `stopPlaybackSession(userId, sessionId)` | 停止一条活跃播放会话 | `playback.session.self/any.stop` |

`self` 和指定用户的方法使用不同能力；管理员身份不会自动获得插件未声明的能力。
所有列表的 `options` 均为 `{limit?, serverId?, includeEnded?}`，`limit` 最大 100。
快照字段的完整定义由 SDK 导出的 `SiteSessionSnapshot`、`EADeviceSnapshot` 和
`PlaybackSessionSnapshot` 给出。

## 通知、网络和调度

| SDK | 说明 | 能力 |
| --- | --- | --- |
| `notifications.sendToMe({title, message})` | 只发给当前用户；标题 120、正文 4000 字符 | `notification.self.send` |
| `notifications.sendToUser(userId, input)` | 管理员指定用户 | `notification.any.send` |
| `notifications.sendToAll(input)` | 管理员广播全部有效用户，返回收件人数 | `notification.broadcast.send` |
| `network.fetch({url, method?, headers?, body?})` | 仅 manifest `allowedHosts`；GET 与写请求分开审批 | `network.read/write` |
| `scheduler.list()` | 返回本插件的全部任务 | `scheduler.read` |
| `scheduler.upsert(name, intervalSeconds, payload?)` | 新增/替换任务并运行 `schedule.<name>` Hook | `scheduler.write` |
| `scheduler.delete(name)` | 删除本插件任务 | `scheduler.write` |

`network.fetch` 仅支持 HTTP(S)，拒绝 URL 凭据、私网字面地址、跳转和敏感请求头；
最多 32 个请求头、512 KB 请求体、2 MB 响应体，15 秒超时。调度名称必须匹配
`[a-z][a-z0-9-]{0,63}`，间隔为 60 秒至 30 天，payload 最大 64 KB，并且
`schedule.<name>` 必须先写入 manifest 的 `events`。

## Agent Tool、事件、Provider 与 Activity

扩展的 `handler` 对应 `definePlugin` 中映射表的 key：

```ts
export default definePlugin({
  agentTools: {
    async 'read-status'(input, ctx) { return { ok: true } },
  },
  eventSubscriptions: {
    async 'on-content-available'(event, ctx) {
      if (await ctx.storage.get(`event/${event.id}`)) return
      await ctx.storage.set(`event/${event.id}`, { time: event.time })
    },
  },
  providers: {
    metadata: { operations: { async search(input, ctx) { return { items: [] } } } },
  },
  workflowActivities: {
    async normalize(input, ctx) { return { normalized: String(input.title).trim() } },
  },
})
```

约束如下：

- Agent Tool 名称必须以 `<plugin.id>.` 开头。`READ_ONLY` 只允许读；`SUPERVISED_WRITE` 必须通过 EM 安全执行内核，不提供直接调用入口。
- 每次扩展调用都会绑定当前包摘要、调用者、租户、关联 ID、输入摘要和幂等键，并写入宿主调用账本。输出只保存经过 Schema 和 Secret 检查的有界 JSON。
- `eventSubscriptions` 只接收 `dataFields` 白名单投影。投递是持久化、至少一次的；失败有退避、死信和人工回放，所以 Handler 必须以 CloudEvent `id` 去重。
- Provider operation 是宿主可发现的协议适配点，不能直接访问 EM/EA 数据库。每个 operation 独立声明输入、输出和所需能力。
- 声明 `protocol` 的 Provider 还要通过版本化兼容校验。`emby-manager.download@1.0` 的 `submit/cancel` 是 `SUPERVISED_WRITE`，只能由宿主 Workflow 经 Policy/审批/Executor 调用；`status` 是 `READ_ONLY`。完整线 Schema 见 [Provider 协议](provider-protocols.md)。
- Workflow Activity 只执行一个可重试步骤并返回数据。它不能决定重试、改变状态或自行推进下一步；这些都属于 Durable Workflow。
- 官方工作流模板目录只收录官方签名插件。模板仍然受每个 Activity 的精确权限、包摘要和宿主策略约束。

## Secret Broker

在 `plugin.json` 中同时声明 `network.secret.use`、`network.allowedHosts` 和精确 `secretScopes`：

```json
{
  "capabilities": ["network.secret.use"],
  "network": { "allowedHosts": ["api.example.com"] },
  "secretScopes": [{
    "name": "provider-api-key",
    "title": "Provider API Key",
    "required": true,
    "allowedHosts": ["api.example.com"],
    "placement": { "type": "header", "name": "Authorization", "prefix": "Bearer " }
  }]
}
```

管理员在 EM 配置 Secret；Runner 只提交 scope、URL 和业务请求。宿主检查 scope 与目标主机后注入请求头，并拒绝重定向、私网地址以及在响应正文或响应头中回显明文、URL 编码值或 Base64 值。
GET 只要求 `network.secret.use`；任何写方法还必须额外声明并获批 `network.write`，Secret Broker 不能被用来绕过网络读写权限拆分。

## 外部账号适配器

`externalAccounts` 只在已验证的 Provider 请求上下文中有效，Provider ID 由宿主
注入，插件不能用参数切换到其他 Provider。

| SDK | 用途 |
| --- | --- |
| `getProvider()` | 当前 Provider 与绑定服务器摘要 |
| `getHealth()` | 当前 Provider 绑定 EA 的有界健康状态；不返回地址或密钥 |
| `listAccounts()` / `getAccount(accountId)` | 当前 Provider 账号快照 |
| `createAccount({name, password?, expiresAt?, idempotencyKey?})` | 创建隐藏身份、EA 账号与线路授权 |
| `authenticate(name, password?)` | 验证当前 Provider 账号，不签发播放 Token |
| `setPassword(accountId, password)` | 改密并撤销旧会话 |
| `setPolicy(accountId, policy)` | 更新受宿主约束的成员策略 |
| `deleteAccount(accountId)` | 删除账号，保留审计台账 |
| `listLibraries()` | 读取脱敏后的 EM 本地库快照 |
| `listItems(accountId, query?)` / `getItem(accountId, itemId, query?)` | 读取按账号策略过滤的本地媒体快照 |
| `setFavorite(accountId, itemId, favorite, query?)` | 修改 EM 模拟账号收藏 |

`externalAccountsAdmin` 只在管理员 Action 中有效：

| SDK | 用途 |
| --- | --- |
| `getOptions()` / `listProviders()` | 读取当前插件可用服务器、适配器及 Provider |
| `createProvider(input)` / `updateProvider(providerId, input)` | 创建或编辑当前插件 Provider |
| `rotateProviderSecret(providerId)` | 轮换 Secret；明文仅在本次响应返回 |
| `deleteProvider(providerId)` | 删除无活动账号的 Provider |
| `reconcileProvider(providerId)` | 在宿主后台启动该 Provider 的全量核对；立即返回任务状态，同 Provider 重复调用不会重复执行 |
| `listAccounts({providerId?, state?, search?, page?, pageSize?})` | 分页按 Provider、状态、搜索词查看台账，返回 `items/total/page/pageSize/totalPages` |
| `reconcileAccount(providerId, accountId)` | 核对一个账号的 EM 身份、EA 用户和线路 |
| `deleteAccount(providerId, accountId)` | 删除一个外部账号并保留审计 |
| `listAudits({providerId?, accountId?, action?, outcome?, search?, page?, pageSize?})` | 分页读取外部账号接入审计 |

每个方法对应的精确能力及额外约束见 [能力清单](capabilities.md)，输入/返回结构
见 SDK 导出的 `ExternalAccountSnapshot`、`ExternalAccountAdminProvider` 和
`ExternalAccountAdminAccount`、`ExternalAccountAdminAudit` 和
`ExternalAccountAdminPage`。传入 `page` 或 `pageSize` 时宿主返回分页对象；不传时
新宿主仍保留旧版最多 200 条的数组响应，因此旧插件不会因宿主升级而失效。官方
适配器也兼容旧版 EM 返回的数组形式。

长时间全量对账不会占住插件 Action。`reconcileProvider()` 返回的 `running` 为 `true`
时，插件应通过 `listProviders()` 中的 `reconcileStatus` 展示后续进度；最终状态包含
重试/限流次数、耗时和逐账号失败诊断。宿主重启后可安全重新发起，因为 EA 用户
创建和线路授权均使用稳定身份及幂等写入。

## 外部账号适配器 Handler

`externalAccountAdapters.<adapterId>.handlers` 的每个 Handler 收到：

```ts
interface ExternalAccountAdapterRequest {
  method: string
  path: string
  params: Record<string, string>
  query: Record<string, string | string[]>
  headers: Record<string, string>
  body: unknown
  requestId: string | null
}
```

返回 `{status, headers?, body?}`。宿主只会路由 manifest 中已声明的 Adapter；
Handler 仍必须通过 `ctx.externalAccounts` 调宿主能力，不能直接连接 EA 或 EM 数据库。

## 常见错误

| 错误码 | 含义 |
| --- | --- |
| `PLUGIN_CAPABILITY_UNDECLARED` | `plugin.json` 未声明该能力 |
| `PLUGIN_CAPABILITY_DENIED` | 管理员未批准该能力 |
| `PLUGIN_ADMIN_CONTEXT_REQUIRED` | 普通用户 Action 尝试管理员能力 |
| `PLUGIN_POINTS_INSUFFICIENT` | 积分不足，未写入部分扣款 |
| `PLUGIN_POINTS_IDEMPOTENCY_CONFLICT` | 同一幂等键被不同交易复用 |
| `PLUGIN_CAPABILITY_INPUT_INVALID` | 参数类型、范围或长度不合法 |
