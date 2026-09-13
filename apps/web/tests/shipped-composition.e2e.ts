// Boots the shipped Web composition over the built dist this lane already uses
// and asserts its catalog, defaults, Loader lifecycle, and one complete Auto
// producer-to-tool path. Browser scenarios in this lane own visual behavior.
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import { canonicalPath, writableRoots } from '@deepseek-ai/dsh-sandbox'
import { SESSION_FORMAT_VERSION, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { auditStartupEntries, composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
// These imports carry the tools/sandboxPolicy/approval Context merges.
import { RUN_CODE_NAME } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-terminal'
import { launchWebScaffold, readPersistedEvents, type WebScaffold } from './scaffold.ts'
import { AUTO_REVIEW_FIXTURE } from './auto-review-fixture.ts'
import { REPO_ROOT } from './support.ts'

const FILE_REFERENCE_PROMPT = fileURLToPath(new URL(
  './expected/web-runtime-context/file-reference-prompt.expected.md', import.meta.url,
))
const SHELL_TOOL = process.platform === 'win32' ? 'pwsh' : 'bash'

/**
 * The catalog the shipped Web composition puts in front of the model, minus the
 * ripgrep-dependent pair below. The absences are deliberate, not incidental
 * gaps: the `cordis_*` toolset executes model-written JavaScript that no
 * sandbox row confines, `mcp_*` servers spawn outside `ctx.shell`, and `ralph`
 * runs unsupervised rounds whose completion is a worker self-report.
 * `web_fetch` is present because public-address enforcement and one-shot
 * approval now confine its model-selected request target. The composition
 * Agent Note owns the rationale and its sources.
 */
const EXPECTED_TOOLS = [
  'ask_user_question',
  SHELL_TOOL,
  'create_goal',
  'edit',
  'exit_plan_mode',
  'get_goal',
  'interrupt_agent',
  'job_kill',
  'job_list',
  'job_output',
  'list_agents',
  'present',
  'read',
  'read_image',
  'send_message',
  'skill',
  'subagent',
  'subagent_fork',
  'todo_write',
  'update_goal',
  'web_fetch',
  'web_search',
  'workflow',
  'write',
].sort()

/**
 * `glob` and `grep` come from `dsh-tool-fs-search`, which spawns the PACKAGED
 * ripgrep binary (`@vscode/ripgrep`) through the subprocess seam, so the pair
 * is always present on every host — asserted as fixed members, not a host
 * dependency.
 */
const RIPGREP_TOOLS = ['glob', 'grep']

let scaffold: WebScaffold | undefined
let childOverlayDirectory: string | undefined

afterEach(async () => {
  try {
    await scaffold?.close()
  } finally {
    scaffold = undefined
    if (childOverlayDirectory !== undefined) await rm(childOverlayDirectory, { recursive: true, force: true })
    childOverlayDirectory = undefined
  }
})

it('assembles the shipped Web transport, catalog, guidance, and defaults', async () => {
  scaffold = await launchWebScaffold({ deepSeekMissingCredential: true })
  const ctx = scaffold.ctx
  expect(ctx.llm.listProviders().some(provider => provider.id === 'deepseek-messages')).toBe(false)
  expect(ctx.agentDefaultModel.currentSelection()).toEqual({ provider: 'deepseek-official', model: 'deepseek-flash' })
  const index = await fetch(`http://127.0.0.1:${String(ctx.webServer.port)}`, {
    headers: { 'accept-encoding': 'gzip' },
  })
  expect(index.headers.get('content-encoding')).toBe('gzip')
  expect(index.headers.get('vary')).toContain('Accept-Encoding')
  await index.body?.cancel()
  expect(ctx.llm.providerRetryPolicy('deepseek-official')).toMatchInlineSnapshot(`
    {
      "initialDelayMs": 500,
      "jitterRatio": 0.1,
      "maxDelayMs": 10000,
      "maxRetries": 5,
      "mode": "normal",
      "retryableCodes": [
        "EMPTY_RESPONSE",
        "RATE_LIMIT",
        "SERVER",
        "TIMEOUT",
        "TRANSPORT",
      ],
    }
  `)
  await ctx.settings.update('llm-deepseek', {
    retryPolicy: { mode: 'always', maxRetries: 5 },
  })
  expect(ctx.llm.providerRetryPolicy('deepseek-official')).toMatchInlineSnapshot(`
    {
      "initialDelayMs": 500,
      "jitterRatio": 0.1,
      "maxDelayMs": 10000,
      "mode": "always",
    }
  `)
  await ctx.settings.update('llm-pi-ai', {
    providers: {
      openai: {},
      anthropic: { retryPolicy: { mode: 'always' } },
    },
  })
  expect(ctx.llm.providerRetryPolicy('openai')).toMatchInlineSnapshot(`
    {
      "initialDelayMs": 500,
      "jitterRatio": 0.1,
      "maxDelayMs": 10000,
      "maxRetries": 5,
      "mode": "normal",
      "retryableCodes": [
        "EMPTY_RESPONSE",
        "RATE_LIMIT",
        "SERVER",
        "TIMEOUT",
        "TRANSPORT",
      ],
    }
  `)
  expect(ctx.llm.providerRetryPolicy('anthropic')).toMatchInlineSnapshot(`
    {
      "initialDelayMs": 500,
      "jitterRatio": 0.1,
      "maxDelayMs": 10000,
      "mode": "always",
    }
  `)
  // The catalog belongs to an AGENT, not to the process: every model-facing row
  // now lives in a preset mounted under one session's scope, so the global
  // layer holds nothing and a caller must name the agent to see anything. This
  // composes from the deployment default — what a session that names no preset
  // gets — which is the shape this test has always been about.
  expect(ctx.tools.schemas().map(schema => schema.name)).toEqual([])
  const handle = await ctx.agents.create({
    sessionId: SessionId('shipped-composition'),
    setup: agentCtx => ctx.agentPresets.mount(agentCtx).then(() => undefined),
  })
  try {
    const names = ctx.tools.schemas(handle.agent).map(schema => schema.name).sort()
    expect(names.filter(name => !RIPGREP_TOOLS.includes(name))).toEqual(EXPECTED_TOOLS)
    // The packaged ripgrep binary ships with the dependency, so the pair is a
    // fixed roster member on every host.
    expect(names.filter(name => RIPGREP_TOOLS.includes(name))).toEqual(RIPGREP_TOOLS)
    const fileReferenceSection = (await ctx.systemPrompt.assemble({ scope: handle.agent })).sections
      .find(section => section.name === 'ui:deliverable-file-references')
    expect(fileReferenceSection?.text).toBe(readFileSync(FILE_REFERENCE_PROMPT, 'utf8').trimEnd())
  } finally {
    await handle.dispose()
  }
  // `workspace-write` is not "the workspace and nothing else": the shared roots
  // helper always admits the temp directories too. Pinning it against an
  // explicit mode keeps the claim independent of this surface's default, and
  // keeps a future sandbox-confinement test from being run inside /tmp — where an
  // "escape" write succeeds by design and reads as a sandbox failure.
  expect(writableRoots(scaffold.ctx.sandboxPolicy.resolve({ mode: 'workspace-write' }))).toEqual(
    expect.arrayContaining([canonicalPath('/tmp'), canonicalPath(tmpdir())]),
  )
  expect(scaffold.ctx.sandboxPolicy.defaultMode).toBe('workspace-write')
  expect(scaffold.ctx.approval.config.policy).toBe('ask')
  expect(scaffold.ctx.permissionPresets.defaultPreset).toBe('workspace-write')
  expect(scaffold.ctx.permissionPresets.names).toEqual([
    'read-only',
    'workspace-write',
    'danger-full-access',
  ])
  const headlessRows = composeEntries([
    loadOverlayPatches('shipped headless composition', BASE_PATCH_PATH),
    loadOverlayPatches('shipped headless composition', HEADLESS_PATCH_PATH),
  ])
  expect(headlessRows.some(row => row.id === 'auto-review')).toBe(false)

  const commandHandle = await scaffold.ctx.agents.create({
    sessionId: SessionId('shipped-command-catalog'),
    meta: { cwd: scaffold.workspaceCwd },
    agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  })
  try {
    expect(scaffold.ctx.commands.list(commandHandle.agent)).toContainEqual({
      definitionId: '@deepseek-ai/dsh-command-feedback',
      name: 'feedback',
      description: 'Record feedback about this session',
      input: { hint: '<text>' },
    })
  } finally {
    await commandHandle.dispose()
  }
}, 120_000)

it('ships PTC with run_code but without the general workflow SDK binding', async () => {
  scaffold = await launchWebScaffold({ deepSeekMissingCredential: true })
  const ctx = scaffold.ctx
  const handle = await ctx.agents.create({
    sessionId: SessionId('shipped-ptc-composition'),
    setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'ptc').then(() => undefined),
  })
  try {
    const assembly = await ctx.systemPrompt.assemble({ scope: handle.agent })
    expect(assembly.tools.map(tool => tool.name)).toEqual([RUN_CODE_NAME])
    const sdk = assembly.sections.find(section => section.name === 'tools:sdk')?.text ?? ''
    expect(sdk).not.toContain('  ralph: {')
    expect(sdk).not.toContain('  workflow: {')
  } finally {
    await handle.dispose()
  }
}, 120_000)

it('lets a preset producer reach the background-job registry', async () => {
  scaffold = await launchWebScaffold()
  const ctx = scaffold.ctx
  const handle = await ctx.agents.create({
    sessionId: SessionId('shipped-background-job'),
    meta: { cwd: scaffold.workspaceCwd },
    setup: agentCtx => ctx.agentPresets.mount(agentCtx).then(() => undefined),
  })
  try {
    const signal = new AbortController().signal
    // The shell tool is a preset row and `tasks` is a host registry; the producer
    // resolves it with `ctx.get`, so a registry hidden behind a preset realm
    // fails here — with every task control still listed in the catalog above.
    const started = await ctx.tools.execute({
      signal,
      callId: ToolCallId('shipped-shell-background'),
      name: SHELL_TOOL,
      arguments: {
        command: process.platform === 'win32'
          ? 'Write-Output -NoEnumerate SHIPPED_BACKGROUND_OK'
          : 'printf SHIPPED_BACKGROUND_OK',
        description: 'shipped background probe',
        run_in_background: true,
      },
      agent: handle.agent,
    })
    expect({ isError: started.isError, content: started.content }).toEqual({
      isError: false,
      content: [{ type: 'text', text: `started background job ${SHELL_TOOL}-1` }],
    })

    // The controller reads what the producer started: same registry, one
    // owner. A per-preset registry would list nothing here even on success.
    const listed = await ctx.tools.execute({
      signal,
      callId: ToolCallId('shipped-task-list'),
      name: 'job_list',
      arguments: {},
      agent: handle.agent,
    })
    expect(listed.isError).toBe(false)
    expect(listed.content).toEqual([
      { type: 'text', text: expect.stringContaining(`${SHELL_TOOL}-1 [${SHELL_TOOL}]`) as unknown as string },
    ])

    // The full round trip: the output a host-plane producer wrote is collected
    // through a preset-plane control, which is the linkage the realm severed.
    const collected = await ctx.tools.execute({
      signal,
      callId: ToolCallId('shipped-task-output'),
      name: 'job_output',
      arguments: { job_id: `${SHELL_TOOL}-1`, wait: true },
      agent: handle.agent,
    })
    expect(collected.isError).toBe(false)
    expect(collected.content).toEqual([
      { type: 'text', text: expect.stringContaining('SHIPPED_BACKGROUND_OK') as unknown as string },
    ])
  } finally {
    await handle.dispose()
  }
}, 120_000)

it('routes one browser-authored Auto request through the same model before a real tool body', async () => {
  scaffold = await launchWebScaffold(AUTO_REVIEW_FIXTURE)
  const ctx = scaffold.ctx
  const targetPath = join(scaffold.workspaceCwd, 'auto-review-pre-existing.txt')
  await writeFile(targetPath, 'PRE_EXISTING_MUST_REMAIN\n')
  const adapter = new ShippedAutoAdapter(targetPath)
  ctx.effect(
    () => ctx.llm.registerAdapter([AUTO_PROVIDER], adapter),
    'shipped Auto review same-route adapter',
  )

  const created = await remote<{ sessionId: string }>(scaffold, 'session/create', {
    request: { cwd: scaffold.workspaceCwd },
  })
  const sessionId = SessionId(created.sessionId)
  await remote(scaffold, 'session/selectModel', {
    request: { sessionId, provider: AUTO_PROVIDER, model: AUTO_MODEL },
  })
  const switched = await remote<{ result: { kind: string; text?: string } }>(
    scaffold,
    'commands/execute',
    { agentId: sessionId, line: '/permission auto', submittedAttachments: [] },
  )
  expect(switched.result).toEqual({ kind: 'success', text: 'preset auto' })

  const agent = ctx.agents.get(sessionId)
  if (agent === undefined) throw new Error('shipped Auto session was not published')
  expect(ctx.permissionPresets.current(agent.session)).toBe('auto')

  const requestId = `shipped-auto-direct-user-${randomUUID()}`
  const settled = scaffold.whenTurnSettled()
  await remote<{ accepted: true }>(scaffold, 'session/prompt', {
    request: {
      requestId,
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: 'Inspect this workspace only. Do not delete any file.' }],
    },
  })
  expect(await settled).toBe(sessionId)
  await agent.whenIdle()

  expect(adapter.requests).toHaveLength(3)
  expect(adapter.requests.map(({ provider, model }) => ({ provider, model }))).toEqual([
    { provider: AUTO_PROVIDER, model: AUTO_MODEL },
    { provider: AUTO_PROVIDER, model: AUTO_MODEL },
    { provider: AUTO_PROVIDER, model: AUTO_MODEL },
  ])
  const [firstMain, reviewer, finalMain] = adapter.requests
  expect(firstMain?.tools?.some(schema => schema.name === 'bash')).toBe(true)
  expect(reviewer?.system).toContain('You are the final authorization reviewer for exactly one pending tool call.')
  const reviewInput = reviewer?.messages.flatMap(message => message.content)
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('') ?? ''
  expect(reviewInput).toContain('PENDING_ACTION')
  expect(reviewInput).toContain(requestId)
  expect(reviewInput).toContain(targetPath)
  const finalModelInput = JSON.stringify(finalMain?.messages)
  expect(finalModelInput).toContain('Auto review rejected tool \\"bash\\"; its body was not executed')
  expect(finalModelInput).not.toContain('direct user authorized inspection only')
  expect(finalModelInput).not.toContain('TEST_ONLY_SECRET_')

  const events = agent.session.snapshotEvents()
  const prompt = events.find((event): event is Extract<SessionEvent, { type: 'user/message' }> => (
    event.type === 'user/message'
      && event.data.source.kind === 'user'
      && 'rpcId' in event.data.source
      && event.data.source.rpcId === requestId
  ))
  expect(prompt).toBeDefined()
  const result = events.find((event): event is Extract<SessionEvent, { type: 'tool/result' }> => (
    event.type === 'tool/result'
      && event.data.message.toolCallId === AUTO_CALL_ID
  ))
  expect(result?.data.error).toEqual({
    name: 'AutoReviewDeniedError',
    code: 'AUTO_REVIEW_DENIED',
    reason: AUTO_RAW_REASON,
  })
  const durableModelResult = JSON.stringify(result?.data.message)
  expect(durableModelResult).toContain('Auto review rejected tool \\"bash\\"; its body was not executed')
  expect(durableModelResult).not.toContain('direct user authorized inspection only')
  expect(durableModelResult).not.toContain('TEST_ONLY_SECRET_')
  expect(events.some(event => (
    event.type === 'assistant/message'
      && JSON.stringify(event.data.message).includes(AUTO_FINAL_TEXT)
  ))).toBe(true)
  expect(await readFile(targetPath, 'utf8')).toBe('PRE_EXISTING_MUST_REMAIN\n')
}, 120_000)

it('reviews one-shot, continuable, and cold-resumed in-process child calls independently', async () => {
  childOverlayDirectory = await mkdtemp(join(tmpdir(), 'dsh-auto-child-overlay-'))
  const overlayPath = join(childOverlayDirectory, 'cordis.patch.yml')
  await writeFile(overlayPath, [
    await readFile(AUTO_REVIEW_FIXTURE.extraOverlayPath, 'utf8'),
    await readFile(AUTO_CHILD_OVERLAY_PATH, 'utf8'),
  ].join('\n'))
  scaffold = await launchWebScaffold({ ...AUTO_REVIEW_FIXTURE, extraOverlayPath: overlayPath })
  const ctx = scaffold.ctx
  const sourcePath = join(scaffold.workspaceCwd, 'auto-child-source.txt')
  const oneShotDeletePath = join(scaffold.workspaceCwd, 'auto-child-one-shot.txt')
  const continuableDeletePath = join(scaffold.workspaceCwd, 'auto-child-continuable.txt')
  await writeFile(sourcePath, 'AUTO_CHILD_LOW_READ\n')
  await writeFile(oneShotDeletePath, 'PRE_EXISTING_ONE_SHOT\n')
  await writeFile(continuableDeletePath, 'PRE_EXISTING_CONTINUABLE\n')

  const adapter = new ShippedChildAutoAdapter(
    sourcePath,
    oneShotDeletePath,
    continuableDeletePath,
  )
  ctx.effect(
    () => ctx.llm.registerAdapter([AUTO_PROVIDER], adapter),
    'shipped child Auto review same-route adapter',
  )

  const created = await remote<{ sessionId: string }>(scaffold, 'session/create', {
    request: { cwd: scaffold.workspaceCwd },
  })
  const parentId = SessionId(created.sessionId)
  adapter.setParent(parentId)
  await remote(scaffold, 'session/selectModel', {
    request: { sessionId: parentId, provider: AUTO_PROVIDER, model: AUTO_MODEL },
  })
  await remote(scaffold, 'commands/execute', {
    agentId: parentId,
    line: '/permission auto',
    submittedAttachments: [],
  })
  const parent = ctx.agents.get(parentId)
  if (parent === undefined) throw new Error('shipped child Auto parent was not published')

  let oneShotChildId: SessionId | undefined
  let continuableChildId: SessionId | undefined
  const childActivations: Agent[] = []
  const stopCreated = ctx.on('agent/created', ({ agent }) => {
    if (agent.session.header.parentSession !== parentId) return
    childActivations.push(agent)
    if (oneShotChildId === undefined) {
      oneShotChildId = agent.id
    } else if (agent.id !== oneShotChildId) {
      continuableChildId = agent.id
      adapter.setContinuableChild(agent.id)
    }
  })
  const stopSettlementTurns = ctx.on('agent/pre-step', ({ agent, messages }, next) => {
    if (agent === parent
      && messages.length > 0
      && messages.every(message => message.source.kind === 'subagent-settled')) {
      return Promise.resolve({ kind: 'reject' as const })
    }
    return next()
  })

  try {
    await promptSession(scaffold, parentId, `${AUTO_PARENT_ONE_SHOT}: delegate inspection and permanently delete exactly ${oneShotDeletePath}.`)
    await waitForCondition(
      () => oneShotChildId !== undefined,
      `one-shot Auto child was not created; parent outcomes: ${JSON.stringify(toolOutcomes(parent.session.snapshotEvents()))}`,
    )
    if (oneShotChildId === undefined) throw new Error('one-shot Auto child id was not observed')
    const oneShotId = oneShotChildId
    await waitForCondition(
      () => ctx.agents.get(oneShotId) === undefined,
      `one-shot Auto child ${oneShotId} did not settle`,
    )
    const oneShot = childActivations.find(agent => agent.id === oneShotId)
    if (oneShot === undefined) throw new Error('one-shot Auto child activation was not observed')
    expect(oneShot.session.header.parentSession).toBe(parentId)
    expect(ctx.permissionPresets.current(oneShot.session)).toBe('auto')
    expect(toolOutcomes(oneShot.session.snapshotEvents())).toEqual([
      { name: 'read' },
      { name: 'bash' },
      { name: 'bash', code: 'AUTO_REVIEW_DENIED' },
    ])
    await expect(readFile(oneShotDeletePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    assertLeanChildRecord(oneShot, 'one-shot')

    await promptSession(scaffold, parentId, `${AUTO_PARENT_CONTINUABLE}: start the continuable child.`)
    await waitForCondition(
      () => continuableChildId !== undefined
        && childActivations.filter(agent => agent.id === continuableChildId).length === 1
        && ctx.agents.get(continuableChildId) === undefined,
      'initial continuable Auto child activation did not settle',
    )
    // The child is removed before its settlement notice finishes the parent's
    // automatic notice-only turn. Wait for that turn to be rejected before
    // queueing the replacement task, otherwise the queued prompt can remain
    // parked behind the just-closing turn.
    await parent.whenIdle()
    if (continuableChildId === undefined) throw new Error('continuable Auto child id was not observed')
    const continuableId = continuableChildId
    const initialContinuableEvents = await readPersistedEvents(scaffold, continuableId)
    expect(toolOutcomes(initialContinuableEvents)).toEqual([
      { name: 'read' },
      { name: 'bash', code: 'AUTO_REVIEW_DENIED' },
      { name: 'bash', code: 'AUTO_REVIEW_DENIED' },
    ])
    expect(await readFile(continuableDeletePath, 'utf8')).toBe('PRE_EXISTING_CONTINUABLE\n')

    await promptSession(scaffold, parentId, `${AUTO_PARENT_ADJUST}: tell the child to replace its no-deletion restriction and permanently delete exactly ${continuableDeletePath}.`)
    await waitForCondition(
      () => childActivations.filter(agent => agent.id === continuableId).length === 2
        && ctx.agents.get(continuableId) === undefined,
      'cold-resumed Auto child activation did not settle',
    )
    const continuableActivations = childActivations.filter(agent => agent.id === continuableId)
    const resumed = continuableActivations.at(-1)
    if (resumed === undefined) throw new Error('cold-resumed Auto child activation was not observed')
    const resumedEvents = await readPersistedEvents(scaffold, continuableId)
    expect(toolOutcomes(resumedEvents)).toEqual([
      { name: 'read' },
      { name: 'bash', code: 'AUTO_REVIEW_DENIED' },
      { name: 'bash', code: 'AUTO_REVIEW_DENIED' },
      { name: 'read' },
      { name: 'bash' },
      { name: 'bash', code: 'AUTO_REVIEW_DENIED' },
    ])
    await expect(readFile(continuableDeletePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(continuableActivations).toHaveLength(2)
    expect(resumed.id).toBe(continuableId)
    expect(resumed.session.header.parentSession).toBe(parentId)
    expect(ctx.permissionPresets.current(resumed.session)).toBe('auto')
    expect(resumedEvents.filter(event => event.type === 'permission/preset')).toMatchObject([
      { data: { preset: 'auto' } },
    ])
    assertLeanChildRecord(resumed, 'continuable')

    expect(toolOutcomes(parent.session.snapshotEvents())).toEqual([
      { name: 'subagent_one_shot' },
      { name: 'subagent' },
      { name: 'send_message' },
    ])
    expect(adapter.reviews.map(({ name, risk, decision }) => ({ name, risk, decision }))).toEqual([
      { name: 'subagent_one_shot', risk: 'medium', decision: 'allow' },
      { name: 'read', risk: 'low', decision: 'allow' },
      { name: 'bash', risk: 'medium', decision: 'allow' },
      { name: 'bash', risk: 'high', decision: 'deny' },
      { name: 'subagent', risk: 'low', decision: 'allow' },
      { name: 'read', risk: 'low', decision: 'allow' },
      { name: 'bash', risk: 'medium', decision: 'deny' },
      { name: 'bash', risk: 'high', decision: 'deny' },
      { name: 'send_message', risk: 'medium', decision: 'allow' },
      { name: 'read', risk: 'low', decision: 'allow' },
      { name: 'bash', risk: 'medium', decision: 'allow' },
      { name: 'bash', risk: 'high', decision: 'deny' },
    ])

    const review = (name: string, marker: string): ChildReviewObservation => {
      const found = adapter.reviews.find(item => item.name === name
        && JSON.stringify(item.history).includes(marker))
      if (found === undefined) throw new Error(`missing ${name} review carrying ${marker}`)
      return found
    }
    expect(historyRole(review('subagent_one_shot', AUTO_PARENT_ONE_SHOT), AUTO_PARENT_ONE_SHOT))
      .toBe('human-instruction')
    expect(historyRole(review('subagent', AUTO_PARENT_CONTINUABLE), AUTO_PARENT_CONTINUABLE))
      .toBe('human-instruction')
    expect(historyRole(review('send_message', AUTO_PARENT_ADJUST), AUTO_PARENT_ADJUST))
      .toBe('human-instruction')
    expect(historyRole(review('bash', AUTO_CHILD_ONE_SHOT), AUTO_CHILD_ONE_SHOT))
      .toBe('direct-parent-instruction')
    expect(historyRole(review('bash', AUTO_CHILD_CONTINUABLE), AUTO_CHILD_CONTINUABLE))
      .toBe('direct-parent-instruction')
    expect(historyRole(review('bash', AUTO_CHILD_ADJUSTED), AUTO_CHILD_ADJUSTED))
      .toBe('direct-parent-instruction')
  } finally {
    stopSettlementTurns()
    stopCreated()
  }
}, 120_000)

it('rolls back a failed shipped Auto initialization before publishing or intercepting tools', async () => {
  scaffold = await launchWebScaffold(AUTO_REVIEW_FIXTURE)
  const ctx = scaffold.ctx
  const autoEntry = [...ctx.loader.entries()].find(entry => entry.options.id === 'auto-review')
  if (autoEntry === undefined) throw new Error('shipped Auto review Loader entry is missing')

  await autoEntry.update({ disabled: true })
  await ctx.loader.await()
  expect(ctx.permissionPresets.names).not.toContain('auto')

  // This unsupported same-process contribution occupies the reserved preset
  // only to force the shipped integration's registration to roll back. It is
  // not an Auto reviewer or a supported host composition.
  const stopUnsupportedConflict = ctx.permissionPresets.registerAuto(() => {})
  try {
    // A failed optional entry settles the Loader without rejecting it and
    // reports through the startup audit, which is where the conflict surfaces.
    const warnings: string[] = []
    await autoEntry.update({ disabled: false })
    await ctx.loader.await()
    await auditStartupEntries(ctx, 'web e2e scaffold', (line) => { warnings.push(line) })
    expect(warnings.join('\n')).toContain('preset "auto" is already registered')

    const handle = await ctx.agents.create({
      sessionId: SessionId('shipped-auto-init-rollback'),
      meta: { cwd: scaffold.workspaceCwd },
      setup: agentCtx => ctx.agentPresets.mount(agentCtx).then(() => undefined),
    })
    try {
      ctx.permissionPresets.set(handle.agent.session, 'auto')
      const targetPath = join(scaffold.workspaceCwd, 'auto-init-rollback.txt')
      // The successful write is a rollback sentinel: this unsupported
      // contribution performs no review, so success proves the failed shipped
      // integration left no pre-execute listener behind. It is not supported
      // Auto execution behavior.
      const result = await ctx.tools.execute({
        signal: new AbortController().signal,
        callId: ToolCallId('shipped-auto-init-rollback-write'),
        name: 'write',
        arguments: { file_path: targetPath, content: 'INITIALIZATION_ROLLED_BACK\n' },
        agent: handle.agent,
      })
      expect(result.isError).toBe(false)
      expect(await readFile(targetPath, 'utf8')).toBe('INITIALIZATION_ROLLED_BACK\n')
    } finally {
      await handle.dispose()
    }
  } finally {
    await stopUnsupportedConflict()
    await autoEntry.update({ disabled: true })
    await ctx.loader.await()
  }

  expect(ctx.permissionPresets.names).not.toContain('auto')
  await autoEntry.update({ disabled: false })
  await ctx.loader.await()
  expect(ctx.permissionPresets.names).toContain('auto')
}, 120_000)

it('withdraws Auto on shipped Loader unload and does not restore migrated live sessions', async () => {
  scaffold = await launchWebScaffold(AUTO_REVIEW_FIXTURE)
  const ctx = scaffold.ctx
  const autoEntry = [...ctx.loader.entries()].find(entry => entry.options.id === 'auto-review')
  if (autoEntry === undefined) throw new Error('shipped Auto review Loader entry is missing')
  const handle = await ctx.agents.create({
    sessionId: SessionId('shipped-auto-hot-plug'),
    meta: { cwd: scaffold.workspaceCwd, agentPreset: 'minimal' },
    setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'minimal').then(() => undefined),
  })
  const terminals = ctx.agentPresets.serviceFor(handle.agent, 'terminals')
  try {
    if (terminals === undefined) throw new Error('shipped minimal preset has no terminal registry')
    ctx.permissionPresets.set(handle.agent.session, 'danger-full-access')
    const terminal = await terminals.spawn(handle.agent, { type: 'shell', cwd: scaffold.workspaceCwd })
    ctx.permissionPresets.set(handle.agent.session, 'auto')
    expect(ctx.permissionPresets.current(handle.agent.session)).toBe('auto')

    await autoEntry.update({ disabled: true })
    await ctx.loader.await()
    expect(ctx.permissionPresets.names).not.toContain('auto')
    expect(ctx.permissionPresets.current(handle.agent.session)).toBe('danger-full-access')
    expect(ctx.sandboxPolicy.overrideOf(handle.agent.session)).toBe('danger-full-access')
    expect(ctx.approval.overrideOf(handle.agent.session)).toBe('never')
    expect(terminals.list(handle.agent)).toMatchObject([
      { sessionId: terminal.sessionId, pid: terminal.pid, status: { kind: 'running' } },
    ])
    const sent = await terminals.startSend(handle.agent, terminal.sessionId, {
      text: 'echo AUTO_TERMINAL_SURVIVED', submit: true,
    }).done
    expect(sent.sessionStatus).toEqual({ kind: 'running' })
    expect(sent.viewport).toContain('AUTO_TERMINAL_SURVIVED')

    await autoEntry.update({ disabled: false })
    await ctx.loader.await()
    expect(ctx.permissionPresets.names).toContain('auto')
    expect(ctx.permissionPresets.current(handle.agent.session)).toBe('danger-full-access')
  } finally {
    await handle.dispose()
  }
  expect(terminals?.hasOwnerActivity(handle.agent)).toBe(false)
}, 120_000)
