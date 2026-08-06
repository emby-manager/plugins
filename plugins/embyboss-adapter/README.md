# EmbyBoss 外部账号适配器

这是官方 Plugin V2 适配器，只负责把 Sakura EmbyBoss 使用的 Emby 账号管理
协议翻译成 EM 的受控能力调用。Provider 鉴权、HMAC 防重放、隐藏用户、EA 生命周期、
线路授权和审计全部仍由 EM 主进程托管。

插件没有数据库、Express、Prisma、EA API Key 或任意网络访问权。每项账号操作都需在
`plugin.json` 单独声明、由管理员批准，并且运行时只能访问当前已鉴权 Provider 的账号。
