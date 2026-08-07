# Hello World

Reference implementation for the Emby Manager Plugin System V2 notification capabilities.

- `greet` is available to every signed-in user and can only call `notifications.sendToMe`.
- `greet-everyone` is an admin action and uses the separately approved `notifications.sendToAll` capability.
- The host, not the plugin, resolves both the current user and the broadcast recipient set.
