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

不想拉取整个插件合集时，可以从长期维护的 `develop-from-here` 分支做 partial clone + sparse checkout。具体命令与“单个 PR 只能修改一个插件目录”的门禁规则见 [CONTRIBUTING.md](CONTRIBUTING.md)。

构建结果是 `.emp` 文件。EM 不会在服务器上安装 npm 依赖或编译 TypeScript，因此必须在提交或导入前完成本地构建。

如需周期任务，读取状态申请 `scheduler.read`，创建、修改或删除任务申请 `scheduler.write`；同时声明 `schedule.<任务名>` 事件，再通过 `ctx.scheduler.upsert()` 注册。插件不能直接导入 Node 模块或自行联网；文件、网络、用户、媒体、通知、Secret 与调度都必须走 SDK 能力接口。

权限遵循“清单先声明、密钥能力上限、管理员逐项批准、调用时再校验”。数据库中即使残留旧授权，只要当前 `plugin.json` 没有声明，对应调用仍会被拒绝。当前用户与任意用户、网络读取与写入、调度读取与写入均为不同能力，不会自动扩大授权范围。

用户页面路径固定在 `/plugins/<slug>`，管理员页面固定在 `/admin/plugins/<slug>`。这可以避免插件覆盖 EM 的核心路由；启用插件时，宿主还会拒绝与其他插件冲突的页面路径。

## 发布方式

- 给本仓库提交 PR：CI 校验、构建、扫描后由官方发布流水线签名。
- 自行发布：使用自己的 Ed25519 密钥签名，站点管理员导入并核对发布者公钥。
- 本地开发：可以构建未签名包，但 EM 只允许低风险能力，并且默认停用。

## 官方信任锚

EM 默认从本仓库的已签名 `catalog/index.json` 获取官方插件，并内置对应的 Ed25519 公钥。签名私钥仅保存在 GitHub `plugin-signing` Environment 的 Secret 中，不会进入 Git 历史。
只有官方仓库 `main` 分支上手动触发的 `Sign and publish plugin` Action 会被允许使用这把私钥。它会通过专用的 `catalog-release/*` PR 更新目录，并等待必需检查后合并；PR 校验流水线不能读取签名 Secret。

- Key ID: `emby-manager-official-2026-01`
- SHA-256 指纹: `da64af36e0a6bc398196ad59fa210a6c071cadaccc389fbc1e345173d59c8b02`
- 公钥: [`keys/emby-manager-official-2026-01.pub.pem`](keys/emby-manager-official-2026-01.pub.pem)

管理员仍需要对插件申请的每项能力单独审批；官方签名只确认包的来源和完整性，不会自动授权。

详细规范见 [能力清单](docs/capabilities.md)、[安全模型](docs/security.md) 与 [Manifest Schema](schemas/plugin.schema.json)。
