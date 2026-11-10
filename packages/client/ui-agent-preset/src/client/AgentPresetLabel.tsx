/** The Session header reuses the preset picker without replacing the conversation. */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { AgentPresetSeat, type AgentPresetSeatInjected } from './AgentPresetSeat.tsx'

/** Registration-side business face for the header label. */
export type AgentPresetLabelInjected = AgentPresetSeatInjected

/** Full component props. */
export type AgentPresetLabelProps =
  PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<'settings.agentPreset'>
  & InjectFace<AgentPresetLabelInjected>

/**
 * Render the current Session's preset picker.
 * @param props - composed slot props.
 * @returns the shared picker and any selection failure.
 */
export function AgentPresetLabel(props: AgentPresetLabelProps) {
  return <AgentPresetSeat {...props} />
}
