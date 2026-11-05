/** Observe bounded job output tails without consuming the normal output cursor. */
import type { JobId } from '@deepseek-ai/dsh-jobs'
import { stripVTControlCharacters } from 'node:util'

/** Maximum observed output retained for matching one live prompt. */
export const JOB_INPUT_WATCH_TAIL_BYTES = 1024
const PROMPT = new RegExp([
  String.raw`(?:password|passphrase)(?:\s+for\s+[^:\r\n]{1,160})?\s*:\s*$`,
  String.raw`\[y/n\]\s*$`,
  String.raw`\(y/n\)\s*$`,
  String.raw`press (?:enter|return) to continue\s*$`,
  String.raw`continue\?\s*\[?y/n\]?\s*$`,
].join('|'), 'i')

interface Candidate {
  raw: string
  timer: ReturnType<typeof setTimeout>
}

/** Observe bounded job output tails and warn only for a prompt followed by silence.
 * @param delayMs - quiet interval after the last matching prompt output.
 * @param changed - receives candidate warning state changes.
 */
export class JobInputWatch {
  private readonly candidates = new Map<JobId, Candidate>()
  private readonly tails = new Map<JobId, string>()

  constructor(private readonly delayMs: number, private readonly changed: (id: JobId, waiting: boolean) => void) {}

  /** Append output observed with the non-consuming registry cursor.
   * @param id - observed registry job.
   * @param chunk - newly observed output text.
   * @returns nothing; matching prompts schedule an observe-only warning.
   */
  output(id: JobId, chunk: string): void {
    const prior = this.candidates.get(id)
    const raw = `${this.tails.get(id) ?? ''}${chunk.slice(-JOB_INPUT_WATCH_TAIL_BYTES)}`.slice(-JOB_INPUT_WATCH_TAIL_BYTES)
    this.tails.set(id, raw)
    if (prior !== undefined) clearTimeout(prior.timer)
    const plain = stripVTControlCharacters(raw).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '')
    const activeLine = plain.split(/[\r\n]/).filter(line => line !== '').at(-1) ?? ''
    if (!PROMPT.test(activeLine)) {
      this.candidates.delete(id)
      this.changed(id, false)
      return
    }
    const timer = setTimeout(() => {
      const candidate = this.candidates.get(id)
      if (candidate?.raw === raw) this.changed(id, true)
    }, this.delayMs)
    this.candidates.set(id, { raw, timer })
    this.changed(id, false)
  }

  /** Cancel a warning after new bytes arrive while retaining the split-prompt tail.
   * @param id - observed registry job with new output.
   */
  activity(id: JobId): void {
    const candidate = this.candidates.get(id)
    if (candidate !== undefined) clearTimeout(candidate.timer)
    this.candidates.delete(id)
    this.changed(id, false)
  }

  /** Forget a tail when its bytes are no longer contiguous.
   * @param id - observed registry job whose tail is incomplete.
   */
  reset(id: JobId): void {
    this.activity(id)
    this.tails.delete(id)
  }

  /** Clear a candidate when the job progresses or stops being observable.
   * @param id - registry job whose warning timer must stop.
   * @returns nothing.
   */
  clear(id: JobId): void {
    this.reset(id)
  }

  /** Cancel every pending warning timer.
   * @returns nothing.
   */
  dispose(): void {
    for (const [id, candidate] of this.candidates) {
      clearTimeout(candidate.timer)
      this.changed(id, false)
    }
    this.candidates.clear()
    this.tails.clear()
  }
}
