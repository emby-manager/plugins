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
| `storage.secret.read` | `secrets.get` | 仅本插件加密 Secret，读取会审计 |
| `storage.secret.write` | `secrets.set/delete` | 仅本插件加密 Secret，变更会审计 |
| `user.profile.self.read` | `users.getMyProfile` | 仅当前认证用户 |
| `user.profile.any.read` | `users.getProfile` | 指定用户；必须由管理员 Action 发起 |
| `user.email.self.read` | `users.getMyEmail` | 仅当前认证用户 |
| `user.email.any.read` | `users.getEmail` | 指定用户；必须由管理员 Action 发起 |
| `user.directory.read` | `users.listDirectory` | 用户目录；必须由管理员 Action 发起 |
| `emby.account.self.read` | `emby.listMyAccounts` | 仅当前认证用户 |
| `emby.account.any.read` | `emby.listAccounts` | 指定用户；必须由管理员 Action 发起 |
| `emby.account.expiry.write` | `emby.updateExpiry` | 仅修改到期时间；必须由管理员 Action 发起并审计 |
| `emby.library.read` | `emby.listLibrary` | 只读媒体索引，返回字段由宿主固定 |
| `notification.self.send` | `notifications.sendToMe` | 仅当前认证用户 |
| `notification.any.send` | `notifications.sendToUser` | 指定用户；必须由管理员 Action 发起并审计 |
| `network.read` | `network.fetch` 的 GET | 仅 manifest `network.allowedHosts`，带 SSRF/大小/超时限制 |
| `network.write` | `network.fetch` 的 POST/PUT/PATCH/DELETE | 同上，写请求单独审批 |
| `scheduler.read` | `scheduler.list` | 仅本插件任务 |
| `scheduler.write` | `scheduler.upsert/delete` | 仅本插件任务；事件必须预先声明为 `schedule.<name>` |

SDK 故意把 `self` 与 `any` 操作拆成不同方法，避免一个可选 `userId` 参数无意间扩大访问范围。插件 Runner 不会获得 Prisma、Express、环境变量、主程序文件、直接网络或 Node 内置模块入口。
