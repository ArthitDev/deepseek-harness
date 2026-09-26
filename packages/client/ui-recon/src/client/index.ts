/**
 * Browser recon viewer plugin contributing one entry to the conversation view
 * slot without defining a service.
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the 'conversation.view' SlotMap row must be in the program for
// the register call to type, and the renderer declares the `slots` service.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: the ModelDirectoryResolver Context merge types the optional
// `modelDirectories` read that routes AI jobs by the Session's selection.
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { DynamicReconResult, ReconAiSelection, ReconQueueEntry, ReconReport } from '@deepseek-ai/dsh-recon-engine/types'
import { en, NS, zh } from './locales.ts'
import { ReconView, reconChatPrompt } from './ReconView.tsx'
import { ReconTargetControl } from './ReconTargetControl.tsx'
import { ReconSettingsCard } from './ReconSettingsCard.tsx'
import { RECON_SETTINGS_NS, ReconSettingsCardController } from './recon-settings-controller.ts'

export type { ReconSettingsCardProps } from './ReconSettingsCard.tsx'
export type {
  ReconSettings, ReconSettingsCardFace, ReconSettingsCardState,
} from './recon-settings-controller.ts'

export interface ReconTargetInjected {
  enqueue: (target: string, aiAssisted: boolean) => Promise<ReconQueueEntry>
  openRecon: () => void
}

/** Required services: slots, locale, and the Remote carrier for the reconRuns namespace. */
export const inject = [
  'slots', 'locale', 'sessions', 'conversation', 'uiConversation',
  'remote', 'remote.reconRuns', 'configForms',
]

/** Client plugin body: register the recon view tab. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-recon: dictionaries')
  const t = ctx.locale.bind(NS)
  const settings = new ReconSettingsCardController(ctx.configForms.get(RECON_SETTINGS_NS))
  ctx.effect(() => () => { settings.dispose() }, 'ui-recon: settings form')
  ctx.effect(() => ctx.configForms.whileServed(
    [RECON_SETTINGS_NS],
    () => ctx.slots.inject('plugins.item', () => ctx.slots.register({
      name: 'plugins.item',
      id: 'recon',
      order: 30,
      label: () => t('settings.title'),
      locale: NS,
      inject: () => settings.inject(),
    }, ReconSettingsCard)),
  ), 'ui-recon: settings page')
  const sessionAiSelection = (sessionId: SessionId): ReconAiSelection | undefined => {
    const directories = ctx.get('modelDirectories')
    if (directories === undefined) return undefined
    try {
      const current = directories.directoryFor(sessionId).store.getSnapshot().current
      return current === null ? undefined : {
        provider: current.provider,
        model: current.model,
        ...(current.reasoningEffort === undefined ? {} : { reasoningEffort: String(current.reasoningEffort) }),
      }
    } catch { /* The session can disappear mid-enqueue; the host then uses its default Main selection. */ }
    return undefined
  }
  const enqueueForSession = async (
    sessionId: SessionId,
    target: string,
    aiAssisted: boolean,
  ): Promise<ReconQueueEntry> => {
    const cwd = ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd
    const aiSelection = sessionAiSelection(sessionId)
    const result = await ctx.remote.reconRuns.enqueue({
      target, aiAssisted,
      ...(cwd === undefined ? {} : { cwd }),
      ...(aiSelection === undefined ? {} : { aiSelection }),
    })
    if (!result.ok) throw new Error(result.error.message)
    ctx.uiConversation.markActivity(sessionId, 'recon')
    return result.value
  }
  const sendToChat = async (sessionId: SessionId, report: ReconReport, dynamic?: DynamicReconResult): Promise<void> => {
    const conversation = ctx.sessions.scope(sessionId)?.get('conversation')
    if (conversation === undefined) throw new Error('ui-recon: conversation service unavailable')
    await conversation.send(reconChatPrompt(report, dynamic))
    ctx.uiConversation.openView(sessionId, 'chat')
  }
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'recon-target',
    order: 10,
    locale: NS,
    inject: (sessionId: SessionId): ReconTargetInjected => ({
      enqueue: (target, aiAssisted) => enqueueForSession(sessionId, target, aiAssisted),
      openRecon: () => {
        ctx.uiConversation.markActivity(sessionId, 'recon')
        ctx.uiConversation.openView(sessionId, 'recon')
      },
    }),
  }, ReconTargetControl))
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'recon',
    order: 30,
    locale: NS,
    label: () => t('view.recon'),
    inject: (sessionId: SessionId) => {
      const actx = ctx.sessions.scope(sessionId)
      if (actx === undefined) throw new Error(`ui-recon: session "${sessionId}" resolved no scope`)
      const conversation = actx.get('conversation')
      if (conversation === undefined) throw new Error('ui-recon: conversation service unavailable')
      return {
        loadRuns: async () => {
          const result = await ctx.remote.reconRuns.list()
          if (!result.ok) throw new Error(result.error.message)
          return result.value
        },
        loadQueue: async () => {
          const result = await ctx.remote.reconRuns.queue()
          if (!result.ok) throw new Error(result.error.message)
          return result.value
        },
        clearQueue: async () => {
          const result = await ctx.remote.reconRuns.clearQueue()
          if (!result.ok) throw new Error(result.error.message)
        },
        loadRun: async (runId: string) => {
          const result = await ctx.remote.reconRuns.load(runId)
          if (!result.ok) throw new Error(result.error.message)
          return result.value
        },
        deleteRun: async (runId: string) => {
          const result = await ctx.remote.reconRuns.discard(runId)
          if (!result.ok) throw new Error(result.error.message)
        },
        loadEvidence: async (runId: string, section: string) => {
          const result = await ctx.remote.reconRuns.evidence(runId, section)
          if (!result.ok) throw new Error(result.error.message)
          return result.value
        },
        loadDynamic: async (runId: string) => {
          const result = await ctx.remote.reconRuns.loadDynamic(runId)
          if (!result.ok) throw new Error(result.error.message)
          return result.value
        },
        enqueueDynamic: async (runId: string) => {
          const aiSelection = sessionAiSelection(sessionId)
          const result = await ctx.remote.reconRuns.enqueueDynamic(runId, {
            ...(aiSelection === undefined ? {} : { aiSelection }),
          })
          if (!result.ok) throw new Error(result.error.message)
          return result.value
        },
        sendToChat: (report: ReconReport, dynamic?: DynamicReconResult) => sendToChat(sessionId, report, dynamic),
        enqueue: (target: string, aiAssisted: boolean) => enqueueForSession(sessionId, target, aiAssisted),
      }
    },
  }, ReconView))
}
