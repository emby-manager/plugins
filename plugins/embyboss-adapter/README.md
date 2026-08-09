# EmbyBoss 外部账号适配器

这是官方 Plugin V2 适配器，只负责把 Sakura EmbyBoss 使用的 Emby 账号管理
协议翻译成 EM 的受控能力调用。Provider 鉴权、HMAC 防重放、隐藏用户、EA 生命周期、
线路授权和审计全部仍由 EM 主进程托管。

插件没有数据库、Express、Prisma、EA API Key 或任意网络访问权。每项账号操作都需在
`plugin.json` 单独声明、由管理员批准，并且运行时只能访问当前已鉴权 Provider 的账号。

管理页按接入、账号状态、审计结果和关键词筛选，账号与审计独立分页。全量对账在宿主
后台运行，页面可刷新查看进度、限流重试次数与失败诊断，不会因为长列表阻塞插件 Action。
接入列表还会通过 EM 提供的受控健康检查显示 EA 在线状态、响应延迟和版本；插件本身
拿不到 EA 地址或 Webhook 密钥。

## EmbyBoss 协议兼容边界

当前适配器通过 `externalAccounts` 宿主能力支持账号创建、认证、改密、成员策略、
用户查询、库列表、按用户媒体、收藏和删除。`ResetPassword=true` 且没有 `NewPw` 时，
适配器返回 HTTP 501 `external_adapter_unsupported`；EM 当前 SDK 没有独立的密码重置
能力，适配器不会把该请求错误地转换为空密码。

Sakura EmbyBoss 中依赖 `/Sessions`、`/Items/Counts`、根 `/Items` 搜索、媒体图片、
`/Devices/Info`、播放会话控制和 `user_usage_stats/submit_custom_query` 的功能，当前
不能仅通过插件声明已有能力来实现。插件 Runner 不允许直接连接 EM/EA 数据库或绕过
宿主网络边界；这些功能需要 EM host 提供绑定当前 Provider 的最小、受审计的 SDK 能力。
