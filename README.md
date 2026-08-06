# Emby Manager Plugins

这是 Emby Manager Plugin System V2 的官方插件合集、公开 SDK、构建工具和模板仓库。

插件不会导入 EM 内部源码。后端插件运行在独立 Runner 中，只能通过经管理员批准的能力接口访问宿主；前端优先使用由 EM 渲染的声明式 UI Schema。

## 创建插件

```bash
npm install
npm run build
cp -R templates/basic plugins/my-plugin
npm run plugin:build -- plugins/my-plugin
```

构建结果是 `.emp` 文件。EM 不会在服务器上安装 npm 依赖或编译 TypeScript，因此必须在提交或导入前完成本地构建。

如需周期任务，读取状态申请 `scheduler.read`，创建、修改或删除任务申请 `scheduler.write`；同时声明 `schedule.<任务名>` 事件，再通过 `ctx.scheduler.upsert()` 注册。插件不能直接导入 Node 模块或自行联网；文件、网络、用户、媒体、通知、Secret 与调度都必须走 SDK 能力接口。

权限遵循“清单先声明、密钥能力上限、管理员逐项批准、调用时再校验”。数据库中即使残留旧授权，只要当前 `plugin.json` 没有声明，对应调用仍会被拒绝。当前用户与任意用户、网络读取与写入、调度读取与写入均为不同能力，不会自动扩大授权范围。

用户页面路径固定在 `/plugins/<slug>`，管理员页面固定在 `/admin/plugins/<slug>`。这可以避免插件覆盖 EM 的核心路由；启用插件时，宿主还会拒绝与其他插件冲突的页面路径。

## 发布方式

- 给本仓库提交 PR：CI 校验、构建、扫描后由官方发布流水线签名。
- 自行发布：使用自己的 Ed25519 密钥签名，站点管理员导入并核对发布者公钥。
- 本地开发：可以构建未签名包，但 EM 只允许低风险能力，并且默认停用。

详细规范见 [能力清单](docs/capabilities.md)、[安全模型](docs/security.md) 与 [Manifest Schema](schemas/plugin.schema.json)。
