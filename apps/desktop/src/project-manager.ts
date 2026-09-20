/** Desktop profile initialization and native recovery. */

import {
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  closeSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { join } from 'node:path'
import {
  DESKTOP_HOST_PACKAGE,
  desktopCorePackageOverrides,
  verifyDesktopCorePackageSet,
} from './core-package-set.ts'
import type { DesktopPaths } from './paths.ts'
import type { DesktopRelease } from './release.ts'
import { readDesktopRuntime } from './runtime-tree.ts'
import {
  initProfile, PROFILE_TEMPLATES, removeLinkProjections, sanitizeProfile, type ProfileTemplate,
} from '@deepseek-ai/dsh-app-boot'

const PROJECT_NAME = '@deepseek-ai/dsh-desktop-runtime'
const DSH_PACKAGE = '@deepseek-ai/dsh'
const CORE_BUILD_PACKAGE = '@deepseek-ai/dsh-subprocess-local'
const WEB_PROFILE = PROFILE_TEMPLATES.web as ProfileTemplate
const WORKSPACE_SETTINGS = 'nodeLinker: hoisted\nautoInstallPeers: false\n'
function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, undefined, 2)}\n`, { mode: 0o600 })
}

function workspaceFile(overrides: Readonly<Record<string, string>> = {}): string {
  const entries = Object.entries(overrides).sort(([left], [right]) => left.localeCompare(right))
  const overrideSection = entries.length === 0
    ? ''
    : `overrides:\n${entries.map(([name, spec]) => `  ${JSON.stringify(name)}: ${JSON.stringify(spec)}`).join('\n')}\n`
  if (entries.length === 0) return `packages:\n  - .\n\n${WORKSPACE_SETTINGS}`
  const coreBuildSpec = overrides[CORE_BUILD_PACKAGE]
  const coreBuildKey = coreBuildSpec === undefined
    ? CORE_BUILD_PACKAGE
    : `${CORE_BUILD_PACKAGE}@${coreBuildSpec.replace('file:./', 'file:')}`
  return `packages:\n  - .\n\n${overrideSection}${WORKSPACE_SETTINGS}allowBuilds:\n  node-pty: true\n  koffi: true\n  fs-ext: true\n  ${JSON.stringify(coreBuildKey)}: true\n  '@google/genai': false\n  protobufjs: false\n  node-addon-require-builtin: false\n`
}

function migrateProfileSettings(projectDir: string): void {
  const path = join(projectDir, 'pnpm-workspace.yaml')
  if (!existsSync(path)) return
  const legacy = `packages:\n  - .\n\n${WORKSPACE_SETTINGS}strictDepBuilds: true\nallowBuilds:\n  node-pty: true\n  koffi: true\n  fs-ext: true\n  "${CORE_BUILD_PACKAGE}": true\n  '@google/genai': false\n  protobufjs: false\n  node-addon-require-builtin: false\n`
  if (readFileSync(path, 'utf8').replaceAll('\r\n', '\n') === legacy) {
    writeFileSync(path, workspaceFile())
  }
}

/** Initializes the Desktop profile and disables third-party bundles during recovery. */
export class DesktopProjectManager {
  /**
   * @param paths - Electron-owned package state and reserved desktop profile paths.
   * @param runtime - location of the bundled application runtime.
   */
  constructor(
    readonly paths: DesktopPaths,
    readonly runtime: { readonly dsh: string },
  ) {}

  /**
   * Back up the profile patch and disable third-party bundles without loading application resources.
   * The caller must stop the Host first.
   * @returns Backup path after the locked profile write, or undefined if the patch was absent.
   */
  async disableAllPlugins(): Promise<string | undefined> {
    return this.withLock(() => sanitizeProfile('dsh', this.paths.profile, WEB_PROFILE.bundles))
  }

  /**
   * Load application metadata and prepare the external plugin profile without installing packages.
   */
  async applyRelease(): Promise<void> {
    await this.withLock(() => {
      // Validation only: an unreadable or mismatched runtime descriptor stops preparation before the Host starts.
      readDesktopRuntime(this.runtime.dsh)
      migrateProfileSettings(this.paths.profile)
      createPluginProfile(this.paths.profile)
      removeLinkProjections(this.paths.profile)
    })
  }

  /** Read the dsh version supplied by this application's verified resources. */
  dshVersion(): string {
    return this.currentRuntime().release.version
  }

  /** Read the release most recently applied to the active profile. */
  releaseVersion(): string {
    const state = readDesktopProfileState(this.paths.profile)
    if (state === undefined) throw new Error('desktop project: active profile has no runtime state')
    return state.version
  }

  /** Reject a profile whose dependency links were prepared for another runtime. */
  assertProfileRuntime(projectDir: string): void {
    if (existsSync(this.pendingPackages)) throw new Error('desktop project: package preparation is incomplete; retry startup')
    if (readDesktopProfileState(projectDir)?.runtimeId !== desktopRuntimeId(this.currentRuntime())) {
      throw new Error('desktop project: profile does not match this application runtime')
    }
  }

  /** @returns Whether application resources support profile recovery. */
  canRecoverProfile(): boolean {
    return this.descriptor !== undefined && existsSync(this.runtime.node) && existsSync(this.runtime.dsh)
  }

  private get pendingPackages(): string { return join(this.paths.profile, 'desktop-packages-pending') }

  private currentRuntime(): DesktopRuntimeDescriptor {
    if (this.descriptor === undefined) throw new Error('desktop project: runtime metadata has not been loaded')
    return this.descriptor
  }

  private readRuntime(): DesktopRuntimeDescriptor {
    this.descriptor = undefined
    return readDesktopRuntime(this.runtime.dsh)
  }

  private prepareProfile(projectDir: string): void {
    const runtime = this.currentRuntime()
    linkDesktopHostPackages(projectDir, this.runtime.dsh, runtime)
    validateDesktopPluginGraph(projectDir, this.runtime.dsh, runtime, profilePluginNames(projectDir))
  }

  /** Read release metadata and reconcile its external profile without installing core packages. */
  async applyRelease(): Promise<boolean> {
    return this.withLock(async () => {
      const target = this.readRuntime()
      this.descriptor = target
      const previous = readDesktopProfileState(this.paths.profile)
      if (!existsSync(this.pendingPackages) && previous?.runtimeId === desktopRuntimeId(target)
        && previous.lockHash === desktopPluginLockHash(this.paths.profile)
        && previous.links.length === target.sharedPackages.length
        && previous.links.every(link => existsSync(link.target)
          && existsSync(join(this.paths.profile, 'node_modules', link.name))
          && realpathSync.native(link.target) === realpathSync.native(join(this.runtime.dsh, 'node_modules', link.name)))) {
        return false
      }
      if (previous === undefined) createPluginProfile(this.paths.profile)
      await this.reconcileProfile(this.paths.profile, previous)
      return true
    })
  }

  /** Modify the current profile while its backend is stopped; failures retain partial changes. */
  async mutate(mutation: DesktopProjectMutation, hooks: DesktopProjectHooks): Promise<void> {
    await this.withLock(async () => {
      this.currentRuntime()
      if (!existsSync(this.paths.profile)) throw new Error('desktop project: active profile is not installed')
      await hooks.beforeChange()
      if (mutation.type === 'plugins-disable-all') {
        const manifest = projectManifest(this.paths.profile)
        writeJson(join(this.paths.profile, 'package.json'), {
          ...manifest,
          dsh: { ...manifest.dsh, profile: { ...manifest.dsh.profile, bundles: [...DESKTOP_PROFILE_BUNDLES] } },
        })
        this.prepareProfile(this.paths.profile)
        await hooks.afterChange()
        return
      }
      const previous = readDesktopProfileState(this.paths.profile)
      const packagesChanged = mutation.type !== 'plugin-toggle'
      if (packagesChanged) unlinkDesktopHostPackages(this.paths.profile)
      try {
        await this.applyMutation(this.paths.profile, mutation)
      } finally {
        if (packagesChanged) linkDesktopHostPackages(this.paths.profile, this.runtime.dsh, this.currentRuntime())
      }
      await this.reconcileProfile(this.paths.profile, previous, packagesChanged)
      await hooks.afterChange()
    })
  }

  private async reconcileProfile(projectDir: string, previous: DesktopProfileState | undefined, packagesChanged = false): Promise<void> {
    const target = this.currentRuntime()
    const rebuild = (!packagesChanged && existsSync(this.pendingPackages))
      || (previous !== undefined && pluginRecords(projectDir).length > 0
      && (previous.nodeVersion !== target.release.nodeVersion || previous.platform !== target.platform || previous.arch !== target.arch))
    if (rebuild) {
      writeFileSync(this.pendingPackages, '')
      unlinkDesktopHostPackages(projectDir)
      removeOwnedDirectory(join(projectDir, 'node_modules'))
      await this.runPnpm(projectDir, ['install', '--frozen-lockfile', '--ignore-scripts'])
    }
    if (rebuild || packagesChanged) await this.finishPackageOperation(projectDir)
    else this.prepareProfile(projectDir)
  }

  private async finishPackageOperation(projectDir: string): Promise<void> {
    this.prepareProfile(projectDir)
    await this.runPnpm(projectDir, ['rebuild', '--pending'])
    this.prepareProfile(projectDir)
    unlinkSync(this.pendingPackages)
  }

  private async applyMutation(projectDir: string, mutation: Exclude<DesktopProjectMutation, { type: 'plugins-disable-all' }>): Promise<void> {
    switch (mutation.type) {
      case 'plugin-add': {
        const requestedName = packageNameFromSpec(mutation.spec)
        if (this.currentRuntime().sharedPackages.some(entry => entry.name === requestedName)) {
          throw new Error(`desktop project: cannot install host-owned package ${requestedName}`)
        }
        await this.runPnpm(projectDir, ['add', mutation.spec, '--save-exact', '--ignore-scripts'])
        const installed = { ...inspectPlugin(projectDir, requestedName), enabled: true }
        const current = pluginRecords(projectDir).filter(plugin => plugin.name !== installed.name)
        writeProfilePlugins(
          projectDir,
          [...current, installed].sort((left, right) => left.name.localeCompare(right.name)),
        )
        return
      }
      case 'plugin-remove': {
        assertPackageName(mutation.name)
        if (!Object.hasOwn(projectManifest(projectDir).dependencies, mutation.name)) {
          throw new Error(`desktop project: plugin ${JSON.stringify(mutation.name)} is not installed`)
        }
        const remaining = pluginRecords(projectDir).filter(plugin => plugin.name !== mutation.name)
        await this.runPnpm(projectDir, ['remove', mutation.name, '--config.ignore-scripts=true'])
        writeProfilePlugins(projectDir, remaining)
        return
      }
      case 'plugin-update':
        assertPackageName(mutation.name)
        assertVersion(mutation.version)
        if (!Object.hasOwn(projectManifest(projectDir).dependencies, mutation.name)) {
          throw new Error(`desktop project: plugin ${JSON.stringify(mutation.name)} is not installed`)
        }
        await this.runPnpm(projectDir, ['add', `${mutation.name}@${mutation.version}`, '--save-exact', '--ignore-scripts'])
        {
          const installed = inspectPlugin(projectDir, mutation.name)
          writeProfilePlugins(
            projectDir,
            pluginRecords(projectDir).map(plugin => plugin.name === installed.name ? installed : plugin),
          )
        }
        return
      case 'plugin-toggle': {
        assertPackageName(mutation.name)
        const plugins = pluginRecords(projectDir)
        if (!plugins.some(plugin => plugin.name === mutation.name)) throw new Error(`desktop project: plugin ${mutation.name} is not installed`)
        writeProfilePlugins(projectDir, plugins.map(plugin => (
          plugin.name === mutation.name ? { ...plugin, enabled: mutation.enabled } : plugin
        )))
        return
      }
      default:
        mutation satisfies never
    }
  }

  private async runPnpm(projectDir: string, args: readonly string[]): Promise<void> {
    const [command, ...commandArgs] = args
    if (command === undefined) throw new Error('desktop project: pnpm command is required')
    for (const path of [this.paths.root, this.paths.pnpm.store, this.paths.pnpm.cache,
      this.paths.pnpm.state, this.paths.pnpm.config, this.paths.pnpm.home]) {
      mkdirSync(path, { recursive: true, mode: 0o700 })
    }
    const npmrc = join(this.paths.pnpm.config, 'npmrc')
    if (!existsSync(npmrc)) writeFileSync(npmrc, '', { mode: 0o600 })
    const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) => (
      name !== 'NODE_OPTIONS' && name !== 'NODE_PATH' && !/^PATH$/iu.test(name)
      && !/^DSH_DESKTOP_/u.test(name) && !/^(?:npm|pnpm|corepack)_/iu.test(name)
    )))
    const seenPaths = new Set<string>()
    const path = [dirname(this.runtime.node), ...(process.env.PATH ?? '').split(delimiter)]
      .filter((entry) => {
        const key = process.platform === 'win32' ? entry.toLowerCase() : entry
        if (entry === '' || seenPaths.has(key)) return false
        seenPaths.add(key)
        return true
      }).join(delimiter)
    writeFileSync(this.pendingPackages, '')
    await new Promise<void>((settle, reject) => {
      const child = spawn(this.runtime.node, [
        this.runtime.pnpm,
        `--config.registry=${DESKTOP_REGISTRY}`,
        `--config.store-dir=${this.paths.pnpm.store}`,
        '--config.enable-global-virtual-store=false',
        `--config.userconfig=${npmrc}`,
        command,
        ...commandArgs,
      ], {
        cwd: projectDir,
        env: {
          ...inherited,
          COREPACK_HOME: this.paths.pnpm.home,
          NPM_CONFIG_REGISTRY: DESKTOP_REGISTRY,
          NPM_CONFIG_STORE_DIR: this.paths.pnpm.store,
          NPM_CONFIG_USERCONFIG: npmrc,
          PATH: path,
          PNPM_HOME: this.paths.pnpm.home,
          XDG_CACHE_HOME: this.paths.pnpm.cache,
          XDG_CONFIG_HOME: this.paths.pnpm.config,
          XDG_STATE_HOME: this.paths.pnpm.state,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let failure: Error | undefined
      let diagnostics = ''
      let completed = false
      const appendDiagnostics = (chunk: string): void => {
        diagnostics = (diagnostics + chunk).slice(-MAX_PNPM_DIAGNOSTIC_BYTES)
      }
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', appendDiagnostics)
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', appendDiagnostics)
      const complete = (settleChild: () => void): void => {
        if (completed) return
        completed = true
        try {
          this.writeLockOwner(process.pid)
        } catch (error) {
          reject(errorOf(error, 'desktop project: failed to return the package transaction lock to Electron'))
          return
        }
        settleChild()
      }
      child.once('error', (error) => { failure = error })
      child.once('close', (code, signal) => {
        complete(() => {
          if (failure !== undefined) { reject(failure); return }
          if (code === 0) {
            settle()
            return
          }
          reject(new Error(
            `desktop project: pnpm exited with ${String(code ?? signal)}${diagnostics.trim() === '' ? '' : `: ${diagnostics.trim()}`}`,
          ))
        })
      })
      try {
        if (child.pid === undefined) throw new Error('desktop project: pnpm did not report a process id')
        this.writeLockOwner(child.pid)
      } catch (error) {
        failure = errorOf(error, 'desktop project: failed to assign the package transaction lock to pnpm')
        child.kill('SIGKILL')
      }
    })
  }

  private writeLockOwner(pid: number): void {
    const descriptor = this.lockDescriptor
    if (descriptor === undefined) throw new Error('desktop project: package transaction lost its lock')
    const content = Buffer.from(`${String(pid)}\n`)
    ftruncateSync(descriptor, 0)
    writeSync(descriptor, content, 0, content.byteLength, 0)
    fsyncSync(descriptor)
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    mkdirSync(this.paths.profile, { recursive: true, mode: 0o700 })
    const lockPath = join(realpathSync(this.paths.profile), 'lock')
    let descriptor: number
    try {
      descriptor = openSync(lockPath, 'wx', 0o600)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        const lock = lstatSync(lockPath)
        if (lock.isSymbolicLink() || !lock.isFile()) {
          throw new Error('desktop project: profile lock is not a regular file')
        }
        const owner = Number.parseInt(readFileSync(lockPath, 'utf8').trim(), 10)
        let active = !Number.isSafeInteger(owner) || owner <= 0
        if (!active) {
          try {
            process.kill(owner, 0)
            active = true
          } catch (signalError) {
            active = (signalError as NodeJS.ErrnoException).code !== 'ESRCH'
          }
        }
        if (active) throw new Error('desktop project: another profile operation is active')
        unlinkSync(lockPath)
        descriptor = openSync(lockPath, 'wx', 0o600)
      } else {
        throw error
      }
    }
    try {
      writeSync(descriptor, `${String(process.pid)}\n`)
      fsyncSync(descriptor)
      return await operation()
    } finally {
      closeSync(descriptor)
      unlinkSync(lockPath)
    }
  }
}

/** Create build-only project metadata for materializing the signed runtime. */
export function createRuntimeProjectMetadata(projectDir: string, release: DesktopRelease): void {
  mkdirSync(projectDir, { recursive: true, mode: 0o700 })
  const packageSet = verifyDesktopCorePackageSet(projectDir, release.version)
  const manifest = {
    name: PROJECT_NAME,
    private: true,
    version: '0.0.0',
    dependencies: desktopCorePackageOverrides(packageSet),
    dsh: { profile: { bundles: [...WEB_PROFILE.bundles] } },
  }
  writeJson(join(projectDir, 'package.json'), manifest)
  writeFileSync(
    join(projectDir, 'pnpm-workspace.yaml'),
    workspaceFile(desktopCorePackageOverrides(packageSet)),
    { mode: 0o600 },
  )
}

/**
 * Create metadata for the unpackaged development project that links the current workspace.
 * @param projectDir - Disposable development profile directory.
 * @param release - Release identity shared by the linked CLI package and Electron shell.
 */
export function createDevelopmentProjectMetadata(projectDir: string, release: DesktopRelease): void {
  mkdirSync(projectDir, { recursive: true, mode: 0o700 })
  const manifest = {
    name: PROJECT_NAME,
    private: true,
    version: '0.0.0',
    dependencies: {
      [DSH_PACKAGE]: release.version,
      [DESKTOP_HOST_PACKAGE]: release.version,
    },
    dsh: { profile: { bundles: [...WEB_PROFILE.bundles] } },
  }
  writeJson(join(projectDir, 'package.json'), manifest)
  writeFileSync(join(projectDir, 'pnpm-workspace.yaml'), workspaceFile(), { mode: 0o600 })
}

/** Create the first external plugin profile without running a package manager. */
export function createPluginProfile(projectDir: string): void {
  initProfile(projectDir, WEB_PROFILE.bundles)
}
