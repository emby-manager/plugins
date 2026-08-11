# Hello World

Reference implementation for the Emby Manager Plugin System V2 notification and Agent-ready extension capabilities.

- `greet` is available to every signed-in user and can only call `notifications.sendToMe`.
- `greet-everyone` is an admin action and uses the separately approved `notifications.sendToAll` capability.
- The host, not the plugin, resolves both the current user and the broadcast recipient set.
- `dev.emby-manager.hello-world.greeting-stats` is a read-only Agent Tool backed only by plugin-owned storage.
- `content.available` is delivered at least once with three explicitly projected fields; the handler deduplicates on `event.id`.
- `greeting-provider.compose` demonstrates a discoverable, side-effect-free Provider operation.
- `compose-greeting` demonstrates a Workflow Activity that returns data while EM owns workflow state and retries.
- The official workflow template is catalog metadata; it does not grant permissions or bypass host approval.

Runtime limits are intentionally modest: 96 MB heap, four concurrent invocations and 16 MB of isolated storage.
