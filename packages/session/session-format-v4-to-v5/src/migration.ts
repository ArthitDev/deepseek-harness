/** Identity body conversion from V4 source events to V5. */

import { SessionFormatError, SessionFormatUnsupportedMigrationError, defineSessionFormatMigration, isSessionFormatJsonObject, sessionFormatCount } from '@deepseek-ai/dsh-session-format'
import type { SessionFormatEvent, SessionFormatEventRun, SessionFormatMigrationContext, SessionFormatMigrationStage, SessionFormatMigrationStageInput } from '@deepseek-ai/dsh-session-format'
import { assertReleasedV4Header } from '@deepseek-ai/dsh-session-format-v3-to-v4'
import { assertReleasedV5Header } from './validation.ts'

/** Header-only migration declaration; body conversion retains every admitted source event unchanged. */
export const sessionFormatV4ToV5 = defineSessionFormatMigration({
  name: '@deepseek-ai/dsh-session-format-v4-to-v5',
  fromVersion: 4,
  toVersion: 5,
  migrateHeader(header) {
    assertReleasedV4Header(header)
    return { ...header, version: 5 }
  },
  createStage: input => new ReleasedV4ToV5Stage(input),
  validateTargetHeader: assertReleasedV5Header,
})

class ReleasedV4ToV5Stage implements SessionFormatMigrationStage {
  readonly headerInheritedEventCount?: number
  private readonly mapping: number[] = []
  private cut: number | undefined
  private sourceCut: number | undefined

  constructor(private readonly input: SessionFormatMigrationStageInput) {
    this.cut = input.sourceHeader.isSeeded ? undefined : 0
    this.sourceCut = this.cut
    if (!input.sourceHeader.isSeeded) this.headerInheritedEventCount = 0
  }

  transformEvent(event: SessionFormatEvent, context: SessionFormatMigrationContext): void {
    if (event.seq !== this.mapping.length) throw new SessionFormatError('V4 source events must be dense')
    if (event.type === 'session/end-seed' && isSessionFormatJsonObject(event.data) && event.data['inherited'] === true) {
      if (!this.input.sourceHeader.isSeeded) throw new SessionFormatError('format v4 unseeded Session contains an inherited end-seed marker')
      this.sourceCut = event.seq
      this.cut = event.seq
    }
    if (event.type === 'session-log-deepseek/delivery-accepted') {
      if (isSessionFormatJsonObject(event.data) && event.data['sessionFormatVersion'] === 5) {
        throw new SessionFormatUnsupportedMigrationError('format v4 delivery marker claims target format v5')
      }
      // Released V4 restore defers version-4 delivery-coordinate and ownership
      // violations to finish-time admission; this stage must not reject them
      // eagerly or recoverable-suffix timing changes.
    }
    this.mapping.push(event.seq)
    context.emitEvent(event)
  }

  transformRun(run: SessionFormatEventRun, context: SessionFormatMigrationContext): void {
    for (const event of run.expand()) this.transformEvent(event, context)
  }

  finish(_context: SessionFormatMigrationContext): number {
    const cut = sessionFormatCount(this.cut, 'V4 inherited event count')
    const sourceCut = sessionFormatCount(this.sourceCut, 'V4 source inherited event count')
    if (this.input.sourceInheritedEventCount !== undefined && sourceCut !== this.input.sourceInheritedEventCount) {
      throw new SessionFormatError('format v4 inherited cut disagrees with its source marker')
    }
    return cut
  }
}
