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

## EmbyBoss 会话健康降级

适配器声明 `external-account.provider.health.read` 并提供 `GET /Sessions`。当宿主返回
当前 Provider 健康状态为 `online` 时，适配器返回合法的空 session 列表，让 Sakura
EmbyBoss 显示“连接正常、0 人”；这只代表连接可达，不代表真实播放人数。健康状态为
`offline` 或 `misconfigured` 时返回 HTTP 503，保留“服务器断连”的错误语义。

该能力只提供连接状态降级，不提供真实播放会话、播放媒体、设备信息或停播控制。版本
`2.2.4` 需要 EM host 同步实现 `ctx.externalAccounts.getHealth()`；未实现该宿主能力的
旧版本不能直接使用本适配器的会话健康降级。
