import { definePlugin } from '@emby-manager/plugin-sdk'

export default definePlugin({
  async activate(ctx) {
    ctx.log.info('plugin activated')
  },
  actions: {
    async hello(_input, ctx) {
      const profile = await ctx.users.getMyProfile()
      await ctx.storage.set('lastGreetingAt', new Date().toISOString())
      return { profile, message: String(ctx.config.greeting || 'Hello') }
    },
  },
  agentTools: {
    async 'read-last-greeting'(_input, ctx) {
      const record = await ctx.storage.get('lastGreetingAt')
      return { lastGreetingAt: typeof record?.value === 'string' ? record.value : null }
    },
  },
})
