# 贡献单个插件

`develop-from-here` 是与 `main` 自动快进同步的开发起点。它不用来直接提交代码；每个插件都应从它创建独立分支。

## 轻量拉取

下面的命令会使用 partial clone 和 sparse checkout，只下载 SDK、CLI、规范、模板与参考插件，不会把整个插件合集展开到本地。

```bash
git clone --branch develop-from-here --single-branch --filter=blob:none --no-checkout \
  https://github.com/emby-manager/plugins.git
cd plugins
git sparse-checkout init --no-cone
git sparse-checkout set \
  '/package.json' '/package-lock.json' '/tsconfig.json' \
  '/packages/' '/schemas/' '/templates/' '/docs/' \
  '/plugins/hello-world/'
git checkout
git switch -c plugin/my-plugin
cp -R templates/basic plugins/my-plugin
```

完成后只提交新插件目录：

```bash
git add plugins/my-plugin
git commit -m "add my plugin"
git push -u origin plugin/my-plugin
```

## PR 边界

每个 PR 必须：

- 只修改一个 `plugins/<plugin>/` 目录；
- 不修改另一个插件；
- 不修改 SDK、CLI、workflow、catalog、schema、文档或其他仓库级文件。

PR 中的重命名会同时检查新旧路径，不能通过把外部文件移入插件目录绕过门禁。超出边界的 PR 会在 `Single plugin scope` 检查中失败。
