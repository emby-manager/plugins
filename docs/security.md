# 插件安全模型

签名只证明发布者身份和包完整性，不代表插件天然安全。EM 同时依赖：

1. `.emp` 中的逐文件 SHA-256 摘要和 Ed25519 签名。
2. “申请能力”和“管理员授予能力”分离。
3. 独立 Plugin Runner、Node Permission Model、单文件模块加载白名单、超时、大小限制和熔断。
4. 插件数据命名空间、加密 Secret 和所有高风险调用审计。
5. 外部网络域名白名单、SSRF 防护和禁止自动重定向。

插件包不得包含原生模块、符号链接、嵌套压缩包、Shell 脚本或服务器端安装步骤。插件不得依赖 EM 内部文件、React 组件、Express、Prisma、环境变量或数据库连接。

生产 Runner 禁止插件直接导入任何 Node.js 模块，并移除直接 `fetch` / `WebSocket` 等网络入口。外部请求必须使用 `ctx.network.fetch()`，这样声明的域名范围、SSRF 检查、响应大小与审计才不会被绕过。官方 CLI 会把 SDK 和依赖打包为单一 `.mjs` 入口，因此这个限制也兼容 EM 主程序的混淆和 Bytenode 构建。

`scheduler.read` 与 `scheduler.write` 使用宿主持久化调度，不允许插件自己创建计时进程。写入任务的插件需先在 `events` 中声明 `schedule.<name>`，再调用 `ctx.scheduler.upsert(name, intervalSeconds, payload)`；最短间隔 60 秒，最长 30 天。更新、回滚或卸载插件时，旧调度都会清除。

“已声明”和“已批准”是两个独立且缺一不可的条件。调用时宿主先确认当前 manifest 明确声明了精确能力，再检查管理员授权；旧包或异常数据库中残留的 Grant 不会让未声明能力生效。`*.self.*` 只允许当前认证用户，`*.any.*` 还要求管理员 Action 上下文；全站通知必须另外声明 `notification.broadcast.send`，且收件人集合完全由宿主生成，插件不能上传用户 ID 列表扩大范围。`network.read` 只允许 GET，其他写方法必须另行申请 `network.write`，且两者仍受 `allowedHosts` 限制。

登录设备和播放会话遵循“本地快照读取、显式控制写入”：

- EM 登录会话只返回设备、IP、客户端和时间，不把 JWT 传给 Runner；
- EA 登录设备由 webhook 同步到 EM，插件列表调用不会请求 EA；
- 播放会话由 webhook 与宿主已有轮询维护，插件列表调用不会临时请求媒体服务器；
- 撤销 EM 会话、撤销 EA 设备、停止播放各有独立能力，不能由相应的读取能力推导；
- 对远端 EA/Emby 的控制请求由宿主发出并持有凭据，Runner 只得到有界结果。

外部账号适配器的库、媒体项目和收藏同样由 EM 本地模拟。宿主在独立后台周期中维护完整媒体快照和跨库多版本成员关系；同步不由插件请求触发，失败时继续保留上一份完整快照。响应不包含媒体文件路径、`MediaSources`、流地址、EA URL、API Key 或 Webhook Key；适配器代码不能直接访问 EA。账号创建、改密、删除、设备撤销和停播属于明确的宿主控制面，不改变“插件数据读取不回源”的原则。

`configSchema` 只接受有界的 JSON Schema 子集。出于主进程 ReDoS 与动态代码生成防护，不支持 `pattern`、`format`、`$ref`、`$defs` 以及未知关键字。

未签名插件只能申请：

- `storage.kv.read`
- `storage.kv.write`
- `storage.secret.read`
- `storage.secret.write`
- `user.profile.self.read`
