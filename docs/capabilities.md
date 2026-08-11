# 能力清单

每个能力都必须同时满足四个条件：

1. 当前 `.emp` 包的 `plugin.json` 明确声明该能力。
2. 签名发布者密钥的能力上限包含该能力；未签名包还受开发模式上限约束。
3. 站点管理员在当前包安装或更新后逐项批准该能力。
4. 每次 SDK 调用时，宿主能力 Broker 再次核对声明、授权、调用用户和资源范围。

旧包、旧授权记录或管理员身份都不能绕过第 1 条。未声明返回
`PLUGIN_CAPABILITY_UNDECLARED`，声明但未批准返回 `PLUGIN_CAPABILITY_DENIED`。

| 能力 | SDK 操作 | 范围与额外条件 |
| --- | --- | --- |
| `storage.kv.read` | `storage.get/list` | 仅本插件命名空间 |
| `storage.kv.write` | `storage.set/delete` | 仅本插件命名空间 |
| `storage.secret.read` | 保留兼容标识 | 当前宿主拒绝 `secrets.get`；Secret 明文不会进入 Runner |
| `storage.secret.write` | `secrets.set/delete` | 仅本插件加密 Secret，变更会审计 |
| `user.profile.self.read` | `users.getMyProfile` | 仅当前认证用户 |
| `user.profile.any.read` | `users.getProfile` | 指定用户；必须由管理员 Action 发起 |
| `user.email.self.read` | `users.getMyEmail` | 仅当前认证用户 |
| `user.email.any.read` | `users.getEmail` | 指定用户；必须由管理员 Action 发起 |
| `user.directory.read` | `users.listDirectory` | 用户目录；必须由管理员 Action 发起 |
| `points.balance.self.read` | `points.getMyBalance` | 仅当前认证用户；只返回总积分与积分单位 |
| `points.balance.any.read` | `points.getBalance` | 指定用户；必须由管理员 Action 发起 |
| `points.balance.self.spend` | `points.spend` | 仅原子扣减当前用户；必须提供原因与幂等键，余额不足则整笔失败 |
| `points.balance.any.adjust` | `points.adjust` | 管理员对指定用户增减积分；必须由管理员 Action 发起，独立记账并审计 |
| `emby.account.self.read` | `emby.listMyAccounts` | 仅当前认证用户 |
| `emby.account.any.read` | `emby.listAccounts` | 指定用户；必须由管理员 Action 发起 |
| `emby.account.expiry.write` | `emby.updateExpiry` | 仅修改到期时间；必须由管理员 Action 发起并审计 |
| `emby.connection.self.read` | `emby.listMyConnections` | 仅当前用户可用的服务器名称与连接地址；不返回 API Key、锁定套餐线路或其他用户数据 |
| `emby.library.read` | `emby.listLibrary` | 只读媒体索引，返回字段由宿主固定 |
| `session.site.self.read` | `sessions.listMySiteSessions` | 当前用户的 EM 站点登录会话；标记当前会话，只返回设备元数据，不返回 JWT |
| `session.site.any.read` | `sessions.listSiteSessions` | 指定用户的 EM 站点登录会话；必须由管理员 Action 发起 |
| `session.site.self.revoke` | `sessions.revokeMySiteSession` | 撤销当前用户的一个 EM 登录会话；与读取权限分离 |
| `session.site.any.revoke` | `sessions.revokeSiteSession` | 撤销指定用户的一个 EM 登录会话；必须由管理员 Action 发起并审计 |
| `device.ea.self.read` | `sessions.listMyEADevices` | 当前用户在 EA 上的登录设备；只读 EM 的本地设备快照，不在调用期间请求 EA |
| `device.ea.any.read` | `sessions.listEADevices` | 指定用户的 EA 登录设备；必须由管理员 Action 发起 |
| `device.ea.self.revoke` | `sessions.revokeMyEADevice` | 将当前用户的一个 EA 设备撤销并通知 EA 失效该设备 Token |
| `device.ea.any.revoke` | `sessions.revokeEADevice` | 撤销指定用户的一个 EA 设备；必须由管理员 Action 发起并审计 |
| `playback.session.self.read` | `sessions.listMyPlaybackSessions` | 当前用户的播放会话镜像；数据来自 EM webhook/宿主轮询，不因插件调用而回源 |
| `playback.session.any.read` | `sessions.listPlaybackSessions` | 指定用户的播放会话镜像；必须由管理员 Action 发起 |
| `playback.session.self.stop` | `sessions.stopMyPlaybackSession` | 停止当前用户的一个活跃播放会话；单独高风险控制权限 |
| `playback.session.any.stop` | `sessions.stopPlaybackSession` | 停止指定用户的一个活跃播放会话；必须由管理员 Action 发起并审计 |
| `notification.self.send` | `notifications.sendToMe` | 仅当前认证用户 |
| `notification.any.send` | `notifications.sendToUser` | 指定用户；必须由管理员 Action 发起并审计 |
| `notification.broadcast.send` | `notifications.sendToAll` | 全部有效站内用户；必须由管理员 Action 发起并审计，插件不能指定或扩展收件人集合 |
| `network.read` | `network.fetch` 的 GET | 仅 manifest `network.allowedHosts`，带 SSRF/大小/超时限制 |
| `network.write` | `network.fetch` 的 POST/PUT/PATCH/DELETE | 同上，写请求单独审批 |
| `network.secret.use` | `secrets.fetch` | 仅 manifest 的精确 Secret scope 与主机；宿主注入，Runner 不接触明文，响应进行泄漏检测 |
| `scheduler.read` | `scheduler.list` | 仅本插件任务 |
| `scheduler.write` | `scheduler.upsert/delete` | 仅本插件任务；事件必须预先声明为 `schedule.<name>` |
| `external-account.provider.read` | `externalAccounts.getProvider` | 仅当前已通过 EM 鉴权且绑定本插件的 Provider；不返回密钥或 EA 地址 |
| `external-account.provider.health.read` | `externalAccounts.getHealth` | 对当前 Provider 绑定的 EA 执行有界健康探测；仅返回状态、延迟、版本和脱敏错误，不返回地址或密钥 |
| `external-account.account.read` | `externalAccounts.listAccounts/getAccount` | 仅当前 Provider 的非删除账号；不返回内部用户、密码摘要或台账 ID |
| `external-account.account.create` | `externalAccounts.createAccount` | 仅当前 Provider，通过 EM 创建隐藏身份、EA 用户和线路授权 |
| `external-account.account.authenticate` | `externalAccounts.authenticate` | 仅验证当前 Provider 账号；不签发播放 Token |
| `external-account.account.password.write` | `externalAccounts.setPassword` | 仅当前 Provider 账号，同时撤销旧会话 |
| `external-account.account.policy.write` | `externalAccounts.setPolicy` | 仅成员安全策略；宿主拒绝管理员、跨用户和内容删除权限 |
| `external-account.account.delete` | `externalAccounts.deleteAccount` | 仅当前 Provider 账号，保留审计台账 |
| `external-account.library.read` | `externalAccounts.listLibraries` | 读取 EM 本地的库配置快照；不返回 EA 路径、地址或密钥，也不请求 EA |
| `external-account.items.read` | `externalAccounts.listItems/getItem` | 读取 EM 后台维护的本地媒体快照（含跨库多版本成员关系）并按当前 Provider 账号策略过滤；不返回路径或流信息 |
| `external-account.favorites.write` | `externalAccounts.setFavorite` | 修改 EM 本地模拟的 Provider 账号收藏，不读写 EA UserData |
| `external-account.provider.manage.read` | `externalAccountsAdmin.getOptions/listProviders` | 管理端读取 Provider 配置摘要；不返回完整 Secret；必须由管理员 Action 发起 |
| `external-account.provider.manage.create` | `externalAccountsAdmin.createProvider` | 创建一个绑定当前适配器的 Provider；必须由管理员 Action 发起并审计 |
| `external-account.provider.manage.update` | `externalAccountsAdmin.updateProvider` | 修改 Provider 名称、启用状态或线路套餐；必须由管理员 Action 发起并审计 |
| `external-account.provider.manage.secret.rotate` | `externalAccountsAdmin.rotateProviderSecret` | 轮换 Provider Secret；新 Secret 只在本次响应出现；必须由管理员 Action 发起 |
| `external-account.provider.manage.delete` | `externalAccountsAdmin.deleteProvider` | 删除无活动账号的 Provider；必须由管理员 Action 发起并审计 |
| `external-account.provider.manage.reconcile` | `externalAccountsAdmin.reconcileProvider` | 触发宿主对当前 Provider 的账号生命周期核对；同 Provider 并发请求会合并，EA 429/超时/5xx 使用有界退避并保留审计；必须由管理员 Action 发起 |
| `external-account.account.manage.read` | `externalAccountsAdmin.listAccounts` | 管理端分页读取外部账号台账摘要；必须由管理员 Action 发起 |
| `external-account.account.manage.reconcile` | `externalAccountsAdmin.reconcileAccount` | 触发宿主核对一个外部账号的隐藏身份、EA 用户和线路状态 |
| `external-account.account.manage.delete` | `externalAccountsAdmin.deleteAccount` | 删除一个 Provider 账号并保留审计台账；必须由管理员 Action 发起 |
| `external-account.audit.read` | `externalAccountsAdmin.listAudits` | 分页、筛选读取当前外部账号接入审计；必须由管理员 Action 发起 |

SDK 故意把 `self` 与 `any` 操作拆成不同方法，避免一个可选 `userId` 参数无意间扩大访问范围。插件 Runner 不会获得 Prisma、Express、环境变量、主程序文件、直接网络或 Node 内置模块入口。

设备和会话的三个域也故意分离：

- `session.site.*` 是 EM 网站 JWT 对应的站点登录，会话列表永远不含 Token；
- `device.ea.*` 是 EA 客户端登录设备，只使用 webhook 已同步到 EM 的设备表；
- `playback.session.*` 是一次播放的本地镜像，优先以 `PlaySessionId` 区分同一设备连续播放的不同媒体。

所有列表调用都是本地读取。只有调用者另外声明并获批 `revoke` 或 `stop` 时，宿主才会执行相应远端控制；插件本身仍看不到控制凭据。

外部账号适配器还多一重资源绑定：能力调用不接受 `providerId` 参数，宿主只从本次
API Key/HMAC 已认证请求注入 Provider，并再次核对 `adapterPluginId + adapterId`。
因此即使插件猜到其他账号或 Provider ID，也不能跨接入读取或修改。

Agent Tool、Provider operation 与 Workflow Activity 中的 `requiredCapabilities` 只能引用顶层 `capabilities` 已声明的能力。扩展声明不会扩大授权，管理员身份、官方签名或宿主工作流也不能替插件补上未声明能力。事件订阅本身不授予数据读取权；它只能看到 `dataFields` 中的精确事件字段。

积分变更另有宿主账本：`pluginId + idempotencyKey` 全局唯一。Runner 因超时重试时，
同一请求仅返回原交易，不会重复扣款或重复发放；同一幂等键改变金额、用户或
原因会返回 `PLUGIN_POINTS_IDEMPOTENCY_CONFLICT`。未签名插件不能获得任何积分能力。
