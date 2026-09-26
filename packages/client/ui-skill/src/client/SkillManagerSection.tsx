import { useEffect, useRef, useState, type FormEvent } from 'react'
import type {
  InstalledSkillsValue, SkillInstallValue, SkillRemoveValue, SkillSearchValue, SkillSetEnabledValue,
  SkillTerminalOpenValue, SkillTerminalReadValue,
} from '@deepseek-ai/dsh-api-remotes/client'
import { Button, IconTrashOutlineRegular, Modal, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { SkillKey } from './locales.ts'
import css from './SkillManagerSection.module.css'

/** Host operations injected into the Skills settings page. */
export interface SkillManagerSectionInjected {
  readonly installed: () => Promise<InstalledSkillsValue>
  readonly search: (query: string) => Promise<SkillSearchValue>
  readonly install: (source: string) => Promise<SkillInstallValue>
  readonly setEnabled: (name: string, enabled: boolean) => Promise<SkillSetEnabledValue>
  readonly remove: (name: string) => Promise<SkillRemoveValue>
  readonly terminalOpen: (command: string) => Promise<SkillTerminalOpenValue>
  readonly terminalRead: (id: string, offset: number) => Promise<SkillTerminalReadValue>
  readonly terminalWrite: (id: string, text: string) => Promise<void>
  readonly terminalClose: (id: string) => Promise<void>
}

/** Skills settings props supplied by the slot renderer. */
export type SkillManagerSectionProps = Partial<InjectFace<SkillManagerSectionInjected>> & {
  readonly t: (key: SkillKey, values?: Readonly<Record<string, string>>) => string
}

/** Search skills.sh and install selected results into the DSH global skill root. */
export function SkillManagerSection(props: SkillManagerSectionProps) {
  const {
    installed, search, install, setEnabled, remove, terminalOpen, terminalRead, terminalWrite, terminalClose, t,
  } = props as InjectFace<SkillManagerSectionInjected> & SkillManagerSectionProps
  const [command, setCommand] = useState('')
  const [query, setQuery] = useState('')
  const [installedSkills, setInstalledSkills] = useState<InstalledSkillsValue['skills']>([])
  const [results, setResults] = useState<SkillSearchValue['skills']>()
  const [busy, setBusy] = useState('list')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [pendingSource, setPendingSource] = useState('')
  const [pendingCommand, setPendingCommand] = useState('')
  const [pendingRemoval, setPendingRemoval] = useState('')
  const [terminalId, setTerminalId] = useState('')
  const [terminalOutput, setTerminalOutput] = useState('')
  const [terminalExited, setTerminalExited] = useState(false)
  const outputRef = useRef<HTMLPreElement>(null)

  const loadInstalled = async (): Promise<void> => {
    setError('')
    try {
      setInstalledSkills((await installed()).skills)
    } catch (failure) {
      setError(String(failure))
    } finally {
      setBusy(current => current === 'list' ? '' : current)
    }
  }

  useEffect(() => { void loadInstalled() }, [])

  useEffect(() => {
    if (terminalId === '') return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let offset = 0
    const poll = async (): Promise<void> => {
      try {
        const result = await terminalRead(terminalId, offset)
        if (!active) return
        offset = result.nextOffset
        if (result.lossy) setTerminalOutput(t('manager.outputTruncated') + result.text)
        else if (result.text !== '') setTerminalOutput(current => current + result.text)
        if (result.error !== undefined) setError(result.error)
        if (result.exited) {
          setTerminalExited(true)
          setTerminalId('')
          void loadInstalled()
          return
        }
        timer = setTimeout(() => { void poll() }, 250)
      } catch (failure) {
        if (!active) return
        setError(String(failure))
        setTerminalId('')
      }
    }
    void poll()
    return () => {
      active = false
      if (timer !== undefined) clearTimeout(timer)
      void terminalClose(terminalId).catch(() => {})
    }
  }, [terminalId])

  useEffect(() => {
    if (outputRef.current !== null) outputRef.current.scrollTop = outputRef.current.scrollHeight
  }, [terminalOutput])

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const value = query.trim()
    if (value.length === 0 || busy !== '') return
    setResults(undefined)
    setBusy('search')
    setError('')
    setNotice('')
    try {
      setResults((await search(value)).skills)
    } catch (failure) {
      setError(String(failure))
    } finally {
      setBusy('')
    }
  }

  const add = async (source: string): Promise<void> => {
    if (busy !== '') return
    setBusy(source)
    setError('')
    setNotice('')
    try {
      const receipt = await install(source)
      const messages = [t('manager.installedNotice', { names: receipt.installed.join(', ') })]
      if (receipt.backedUp.length > 0) {
        messages.push(t('manager.backupNotice', { names: receipt.backedUp.join(', ') }))
      }
      setNotice(messages.join(' '))
      setInstalledSkills((await installed()).skills)
    } catch (failure) {
      setError(String(failure))
    } finally {
      setBusy('')
    }
  }

  const requestInstall = (source: string): void => {
    if (busy === '') {
      setPendingCommand('')
      setPendingSource(source)
    }
  }

  const toggleSkill = async (name: string, enabled: boolean): Promise<void> => {
    if (busy !== '') return
    setBusy(`skill:${name}`)
    setError('')
    try {
      const updated = await setEnabled(name, enabled)
      setInstalledSkills(current => current.map(skill => skill.name === name ? updated : skill))
    } catch (failure) {
      setError(String(failure))
    } finally {
      setBusy('')
    }
  }

  const removeSkill = async (name: string): Promise<void> => {
    if (busy !== '') return
    setBusy(`remove:${name}`)
    setError('')
    setNotice('')
    try {
      const result = await remove(name)
      setInstalledSkills(current => current.filter(skill => skill.name !== name))
      setNotice(t(result.removed ? 'manager.removedNotice' : 'manager.alreadyRemovedNotice', { name }))
    } catch (failure) {
      setError(String(failure))
    } finally {
      setBusy('')
    }
  }

  const startTerminal = async (value: string): Promise<void> => {
    setBusy('terminal')
    setError('')
    setNotice('')
    setTerminalOutput('')
    setTerminalExited(false)
    try {
      setTerminalId((await terminalOpen(value)).id)
      setCommand('')
    } catch (failure) {
      setError(String(failure))
    } finally {
      setBusy('')
    }
  }

  const submitCommand = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (busy !== '') return
    if (terminalId !== '') {
      const value = command
      setCommand('')
      try {
        await terminalWrite(terminalId, `${value}\r`)
      } catch (failure) {
        setError(String(failure))
      }
      return
    }
    const value = command.trim()
    if (value === '') return
    setPendingSource('')
    setPendingCommand(value)
  }

  return (
    <section className={css.section} aria-busy={busy !== ''}>
      <h2>{t('manager.title')}</h2>
      <p className={css.intro}>{t('manager.intro')}</p>
      <p className={css.warning}>{t('manager.warning')}</p>
      <div className={css.terminal}>
        <div className={css.terminalBar}>
          <span className={css.terminalDots} aria-hidden="true"><i /><i /><i /></span>
          <span>{t('manager.commandLabel')}</span>
          <span className={css.terminalActions}>
            {terminalId !== '' ? (
              <>
                <button type="button" onClick={() => {
                  void terminalWrite(terminalId, '\x03').catch((failure: unknown) => { setError(String(failure)) })
                }}>
                  {t('manager.interrupt')}
                </button>
                <button type="button" onClick={() => {
                  void terminalClose(terminalId)
                    .then(() => { setTerminalId('') })
                    .catch((failure: unknown) => { setError(String(failure)) })
                }}>
                  {t('manager.stop')}
                </button>
              </>
            ) : terminalExited ? t('manager.exited') : null}
          </span>
        </div>
        <form className={css.terminalBody} onSubmit={(event) => { void submitCommand(event) }}>
          <label className={css.visuallyHidden} htmlFor="skill-command">{t('manager.commandLabel')}</label>
          <p className={css.terminalHint}>{t('manager.commandHint')}</p>
          {terminalOutput !== '' ? (
            <pre ref={outputRef} className={css.terminalOutput} aria-live="polite">{terminalOutput}</pre>
          ) : null}
          <div className={css.terminalPrompt}>
            <span aria-hidden="true">❯</span>
            <input
              id="skill-command"
              value={command}
              maxLength={16_384}
              placeholder={t(terminalId === '' ? 'manager.commandPlaceholder' : 'manager.inputPlaceholder')}
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              disabled={busy !== ''}
              onChange={(event) => { setCommand(event.target.value) }}
            />
            <kbd aria-hidden="true">{t('manager.commandSubmit')}</kbd>
          </div>
        </form>
      </div>
      <form className={css.search} onSubmit={(event) => { void submit(event) }}>
        <label htmlFor="skill-search">{t('manager.searchLabel')}</label>
        <div className={css.searchRow}>
          <input
            id="skill-search"
            value={query}
            maxLength={100}
            placeholder={t('manager.searchPlaceholder')}
            disabled={busy !== ''}
            onChange={(event) => { setQuery(event.target.value) }}
          />
          <button type="submit" disabled={busy !== '' || query.trim().length === 0}>
            {t(busy === 'search' ? 'manager.searching' : 'manager.search')}
          </button>
          <a href="https://skills.sh/" target="_blank" rel="noreferrer">{t('manager.openCatalog')}</a>
        </div>
      </form>
      {error !== '' ? <p className={css.error} role="alert">{error}</p> : null}
      {notice !== '' ? <p className={css.notice} role="status">{notice}</p> : null}
      {results !== undefined ? (
        <div className={css.group}>
          <h3>{t('manager.results')}</h3>
          {results.length === 0 ? <p className={css.empty}>{t('manager.noResults')}</p> : (
            <ul>
              {results.map(skill => (
                <li key={skill.source}>
                  <div>
                    <a href={skill.url} target="_blank" rel="noreferrer">{skill.name}</a>
                    <code>{skill.source}</code>
                  </div>
                  <button type="button" disabled={busy !== ''} onClick={() => { requestInstall(skill.source) }}>
                    {t(busy === skill.source ? 'manager.installing' : 'manager.install')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
      <div className={css.group}>
        <h3>{t('manager.installed')}</h3>
        {busy === 'list' ? <p className={css.empty}>{t('manager.loading')}</p>
          : installedSkills.length === 0 ? <p className={css.empty}>{t('manager.empty')}</p>
            : (
              <ul className={css.installed}>{installedSkills.map(skill => (
                <li key={skill.name}>
                  <code>{skill.name}</code>
                  <div className={css.installedActions}>
                    <Switch
                      checked={skill.enabled}
                      label={t(skill.enabled ? 'manager.disableSkill' : 'manager.enableSkill', { name: skill.name })}
                      disabled={busy !== ''}
                      onChange={(enabled) => { void toggleSkill(skill.name, enabled) }}
                    />
                    <button
                      type="button"
                      className={css.removeSkill}
                      aria-label={t('manager.removeSkill', { name: skill.name })}
                      title={t('manager.remove')}
                      disabled={busy !== ''}
                      onClick={() => { setPendingRemoval(skill.name) }}
                    >
                      <IconTrashOutlineRegular />
                    </button>
                  </div>
                </li>
              ))}</ul>
            )}
      </div>
      <Modal
        open={pendingSource !== '' || pendingCommand !== ''}
        onClose={() => { setPendingSource(''); setPendingCommand('') }}
        title={pendingCommand !== ''
          ? t('manager.runTitle')
          : pendingSource === '' ? '' : t('manager.confirmTitle', { source: pendingSource })}
        description={t(pendingCommand !== '' ? 'manager.runDescription' : 'manager.confirmDescription')}
        closeLabel={t('manager.close')}
        footer={(
          <>
            <Button variant="outline" autoFocus onClick={() => { setPendingSource(''); setPendingCommand('') }}>
              {t('manager.cancel')}
            </Button>
            <Button onClick={() => {
              if (pendingCommand !== '') {
                const value = pendingCommand
                setPendingCommand('')
                void startTerminal(value)
                return
              }
              const source = pendingSource
              setPendingSource('')
              void add(source)
            }}>
              {t(pendingCommand !== '' ? 'manager.run' : 'manager.install')}
            </Button>
          </>
        )}
      >
        {pendingCommand === '' ? null : <code className={css.pendingCommand}>{pendingCommand}</code>}
      </Modal>
      <Modal
        open={pendingRemoval !== ''}
        onClose={() => { setPendingRemoval('') }}
        title={pendingRemoval === '' ? '' : t('manager.removeTitle', { name: pendingRemoval })}
        description={t('manager.removeDescription')}
        closeLabel={t('manager.close')}
        footer={(
          <>
            <Button variant="outline" autoFocus onClick={() => { setPendingRemoval('') }}>
              {t('manager.cancel')}
            </Button>
            <Button
              variant="outline"
              className={css.removeConfirm}
              onClick={() => {
                const name = pendingRemoval
                setPendingRemoval('')
                void removeSkill(name)
              }}
            >
              {t('manager.remove')}
            </Button>
          </>
        )}
      />
    </section>
  )
}
