/** Recorded ACP protocol behavior through the shipped `dsh --profile acp` interface. */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  defineAcpSnapshotSuite,
  parseSnapshotManifest,
  type Scenario,
  type SnapshotSuiteOptions,
} from '@deepseek-ai/dsh-session-snapshot'

const corpusDir = fileURLToPath(new URL('./', import.meta.url))

function snapshotMode(value: string | undefined): SnapshotSuiteOptions['mode'] {
  switch (value) {
    case undefined:
    case '':
    case 'replay': return 'replay'
    case 'record': return 'record'
    case 'refresh': return 'refresh'
    default: throw new Error(`unknown DSH_SNAPSHOT mode: ${value}`)
  }
}

const controllerCases: readonly {
  readonly name: string
  readonly hasModelTurn: boolean
  readonly configPath?: string
}[] = [
  { name: 'handshake', hasModelTurn: false },
  { name: 'reject-extra-dirs', hasModelTurn: false },
  { name: 'cancel', hasModelTurn: true },
  { name: 'cancel-tool-calls', hasModelTurn: true },
  { name: 'escalation-approved', hasModelTurn: true },
  { name: 'escalation-rejected', hasModelTurn: true },
  { name: 'fs-escalation-approved', hasModelTurn: true },
  { name: 'fs-same-mode', hasModelTurn: true },
  {
    name: 'image-compaction',
    hasModelTurn: true,
    configPath: join(corpusDir, 'image-compaction', 'cordis.yml'),
  },
] as const

const scenarios: Scenario[] = controllerCases.map((controller) => {
  const manifestPath = join(corpusDir, controller.name, 'snapshot.yml')
  const manifest = parseSnapshotManifest(readFileSync(manifestPath, 'utf8'), manifestPath)
  if (manifest.recording === undefined || manifest.header === undefined) {
    throw new Error(`${controller.name}: ACP snapshot manifest lacks recording or header metadata`)
  }
  return {
    ...controller,
    recorded: manifest.recording === 'live',
    ...(manifest.sessionFormat === undefined ? {} : { sessionFormat: manifest.sessionFormat }),
    ...(manifest.replay?.override === true ? { overridden: true } : {}),
    ...(manifest.header.pin === true ? { pinsHeader: true } : {}),
    ...(manifest.header.changes === undefined ? {} : { expectedHeaderChanges: manifest.header.changes }),
    ...(manifest.header.promptChanges === undefined ? {} : { expectedPromptChanges: manifest.header.promptChanges }),
    headerClass: manifest.header.class,
    ...(manifest.header.systemPromptSource === undefined ? {} : { systemPromptSource: manifest.header.systemPromptSource }),
    ...(manifest.header.toolSchemasSource === undefined ? {} : { toolSchemasSource: manifest.header.toolSchemasSource }),
    ...(manifest.platform === 'posix' ? { posixOnly: true } : {}),
    ...(manifest.platform === 'pwsh' ? { pwshOnly: true } : {}),
    ...(controller.configPath === undefined ? {} : { configPath: controller.configPath }),
    ...manifest.permission === undefined && manifest.environment === undefined
      ? {}
      : {
          env: {
            ...manifest.environment,
            ...(manifest.permission === undefined ? {} : { DSH_PERMISSION_MODE: manifest.permission }),
          },
        },
  }
})

defineAcpSnapshotSuite({
  agent: {
    binScript: fileURLToPath(new URL('../../apps/cli/src/bin.ts', import.meta.url)),
    configPath: fileURLToPath(new URL('./escalation-approved/cordis.yml', import.meta.url)),
    profile: 'acp',
    tsconfigPath: fileURLToPath(new URL('../../tsconfig.json', import.meta.url)),
  },
  snapshotsDir: corpusDir,
  scenarios,
  mode: snapshotMode(process.env.DSH_SNAPSHOT),
})
