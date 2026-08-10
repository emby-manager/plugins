---
name: develop-emby-manager-plugin
description: Build, update, review, test, and package Emby Manager v2 plugins in the emby-manager/plugins repository. Use when working on plugin.json, plugin server actions, declarative plugin UI, external-account adapters, SDK capabilities, plugin tests, .emp packages, or a single-plugin contribution PR. Enforce declared-and-approved least privilege, isolated storage, Runner restrictions, repository scope gates, and compatibility with the obfuscated EM host.
---

# Develop an Emby Manager Plugin

Build one v2 plugin through the public SDK and declarative UI. Treat capability declaration as a strict security boundary: code must never use a capability that the manifest does not declare.

## Load repository rules

Work from the repository root. Read these files completely before editing:

1. `CONTRIBUTING.md`
2. `docs/capabilities.md`
3. `docs/security.md`
4. `docs/sdk-api.md`
5. `schemas/plugin.schema.json`

For a new plugin, also inspect `templates/basic/` and `plugins/hello-world/`. For an existing plugin, read its complete `plugin.json`, `README.md`, `src/`, `ui/`, and tests.

## Keep the change in one plugin

- Put all plugin code, tests, UI, and plugin documentation under `plugins/<slug>/`.
- Use lowercase kebab-case for `<slug>`.
- Give a new community plugin a unique reverse-domain ID. Never use the reserved `io.emby-manager.*` or `dev.emby-manager.*` namespaces.
- Preserve an existing plugin ID. Increase its SemVer version whenever package contents change.
- Do not edit SDK, CLI, schemas, workflows, catalog, templates, documentation, or a second plugin in an ordinary community-plugin change.
- If the required SDK capability does not exist, stop plugin implementation and describe the smallest host capability needed. Never import EM internals as a workaround.

Repository-maintenance work may intentionally change infrastructure, but keep it separate from a single-plugin contribution.

## Design the permission boundary first

List every intended SDK call before coding, then map each call to the exact capability in `docs/capabilities.md`.

- Declare only capabilities used by the current version.
- Use `*.self.*` for actions available to ordinary users.
- Use `*.any.*` only in an administrator action.
- Declare reads and writes separately.
- Declare revoke, stop, broadcast, balance adjustment, network write, and Secret access separately from their related read capability.
- Put every external host in `network.allowedHosts`; do not use broad wildcards.
- Store ordinary plugin state in `ctx.storage` and credentials in `ctx.secrets`.
- Do not accept a user ID in a self-scoped action to simulate an any-scoped operation.
- Do not continue when an undeclared or denied capability fails. Surface a bounded, useful error.

After coding, search every `ctx.<broker>` call and reconcile the manifest again. An unused declaration or an undeclared call is a release blocker.

## Implement only through supported surfaces

- Export server behavior with `definePlugin(...)` from `@emby-manager/plugin-sdk`.
- Treat all Action input as untrusted. Bound strings, arrays, pagination, amounts, and enum values.
- Keep outputs bounded and serializable. Never return paths, tokens, secrets, internal database IDs, or raw upstream error bodies.
- Use declarative `ui/*.json`; do not ship React, HTML, or executable browser JavaScript.
- Do not import Node built-ins, use direct `fetch` or WebSocket, read environment variables, spawn processes, or access files and databases.
- Use `ctx.network.fetch` for approved external traffic and the appropriate broker for host data or mutations.
- Keep user and administrator actions separate. Test that a normal user cannot invoke administrator behavior.
- For external-account adapters, access EA only through the EM-simulated broker. Never connect to EA directly or retain EA credentials.

The CLI bundles the SDK and dependencies into one entry module. This public boundary is what keeps plugins compatible with minified, obfuscated, and Bytenode-built EM releases; never depend on host source names or bundle layout.

## Document and test

In the plugin `README.md`, explain:

- what the plugin does and where its user/admin pages appear;
- why each capability is necessary;
- whether it uses the network and which hosts it contacts;
- which values are state versus Secret;
- failure behavior, recovery, upgrade, and uninstall impact.

Add tests for normal input, invalid input, denied capability, role boundaries, bounded output, and sensitive-data leakage. Add protocol-specific cases for adapters and network integrations.

## Validate and package

Run the narrow checks first, then the repository gate:

```bash
npm run typecheck
npm test
npm run plugin:build -- plugins/<slug>
npm run plugin:verify -- dist/<plugin-id>-<version>.emp
npm run validate
npm audit --omit=dev --audit-level=high
```

Inspect `git diff -- plugins/<slug>` and `git status --short`. For a community PR, only the selected plugin directory may be changed. Do not add `.emp` output, private keys, `.env`, credentials, production responses, or real user/media data.

Official trust comes only from the repository release Action. Never create, copy, or use the official private signing key locally. A valid signature still does not grant capabilities; administrators approve every requested capability for the installed version.

## Report the result

State the plugin/version changed, capabilities added or removed, tests run, package verification result, and any administrator action required after update. Call out any capability request that was intentionally rejected or left for host work.
