/** Keep the shared replay catalog portable while retaining user-invocable ACL diagnosis. */
export const name = 'snapshot-portable-skill-catalog'
export const inject = ['skills']

/** @param {import('@deepseek-ai/cordis').Context} ctx - Fixture runtime context. */
export function apply(ctx) {
  ctx.on('agent/created', async () => {
    const diagnosis = await ctx.skills.get('diagnose-windows-sandbox-acl')
    if (diagnosis !== undefined) {
      ctx.skills.register({ ...diagnosis, invocation: { modelInvocable: false, userInvocable: true } })
    }
  })
}
