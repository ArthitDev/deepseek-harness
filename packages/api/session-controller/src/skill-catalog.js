/** Session-addressed catalog plus user-global skill management Remotes. */
var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
var __addDisposableResource = (this && this.__addDisposableResource) || function (env, value, async) {
    if (value !== null && value !== void 0) {
        if (typeof value !== "object" && typeof value !== "function") throw new TypeError("Object expected.");
        var dispose, inner;
        if (async) {
            if (!Symbol.asyncDispose) throw new TypeError("Symbol.asyncDispose is not defined.");
            dispose = value[Symbol.asyncDispose];
        }
        if (dispose === void 0) {
            if (!Symbol.dispose) throw new TypeError("Symbol.dispose is not defined.");
            dispose = value[Symbol.dispose];
            if (async) inner = dispose;
        }
        if (typeof dispose !== "function") throw new TypeError("Object not disposable.");
        if (inner) dispose = function() { try { inner.call(this); } catch (e) { return Promise.reject(e); } };
        env.stack.push({ value: value, dispose: dispose, async: async });
    }
    else if (async) {
        env.stack.push({ async: true });
    }
    return value;
};
var __disposeResources = (this && this.__disposeResources) || (function (SuppressedError) {
    return function (env) {
        function fail(e) {
            env.error = env.hasError ? new SuppressedError(e, env.error, "An error was suppressed during disposal.") : e;
            env.hasError = true;
        }
        var r, s = 0;
        function next() {
            while (r = env.stack.pop()) {
                try {
                    if (!r.async && s === 1) return s = 0, env.stack.push(r), Promise.resolve().then(next);
                    if (r.dispose) {
                        var result = r.dispose.call(r.value);
                        if (r.async) return s |= 2, Promise.resolve(result).then(next, function(e) { fail(e); return next(); });
                    }
                    else s |= 1;
                }
                catch (e) {
                    fail(e);
                }
            }
            if (s === 1) return env.hasError ? Promise.reject(env.error) : Promise.resolve();
            if (env.hasError) throw env.error;
        }
        return next();
    };
})(typeof SuppressedError === "function" ? SuppressedError : function (error, suppressed, message) {
    var e = new Error(message);
    return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
});
import { cp, mkdir, mkdtemp, readdir, rename, rm, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths';
import { SessionQueryError } from '@deepseek-ai/dsh-session-query';
import { isUserInvocable } from '@deepseek-ai/dsh-skill';
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { presetServiceOf } from "./preset-service.js";
const CLI_OUTPUT_LIMIT = 128 * 1024;
const CLI_TIMEOUT_MS = 120_000;
const TERMINAL_OUTPUT_LIMIT = 512 * 1024;
const TERMINAL_INPUT_LIMIT = 16 * 1024;
const SKILL_NAME = /^[a-z0-9][a-z0-9._-]*$/;
const SEARCH_RESULT = /\b([a-z0-9_.-]+\/[a-z0-9_.-]+@([a-z0-9_.-]+))\b/gi;
const ANSI_ESCAPE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
/** Host service backing `ctx.remote.skills` without activating a cold Agent. */
let SessionSkillCatalog = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _terminalOpen_decorators;
    let _terminalRead_decorators;
    let _terminalWrite_decorators;
    let _terminalClose_decorators;
    let _installed_decorators;
    let _setEnabled_decorators;
    let _remove_decorators;
    let _search_decorators;
    let _install_decorators;
    let _list_decorators;
    return class SessionSkillCatalog extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _terminalOpen_decorators = [Remote];
            _terminalRead_decorators = [Remote];
            _terminalWrite_decorators = [Remote];
            _terminalClose_decorators = [Remote];
            _installed_decorators = [Remote];
            _setEnabled_decorators = [Remote];
            _remove_decorators = [Remote];
            _search_decorators = [Remote];
            _install_decorators = [Remote('add')];
            _list_decorators = [Remote];
            __esDecorate(this, null, _terminalOpen_decorators, { kind: "method", name: "terminalOpen", static: false, private: false, access: { has: obj => "terminalOpen" in obj, get: obj => obj.terminalOpen }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _terminalRead_decorators, { kind: "method", name: "terminalRead", static: false, private: false, access: { has: obj => "terminalRead" in obj, get: obj => obj.terminalRead }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _terminalWrite_decorators, { kind: "method", name: "terminalWrite", static: false, private: false, access: { has: obj => "terminalWrite" in obj, get: obj => obj.terminalWrite }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _terminalClose_decorators, { kind: "method", name: "terminalClose", static: false, private: false, access: { has: obj => "terminalClose" in obj, get: obj => obj.terminalClose }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _installed_decorators, { kind: "method", name: "installed", static: false, private: false, access: { has: obj => "installed" in obj, get: obj => obj.installed }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _setEnabled_decorators, { kind: "method", name: "setEnabled", static: false, private: false, access: { has: obj => "setEnabled" in obj, get: obj => obj.setEnabled }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remove_decorators, { kind: "method", name: "remove", static: false, private: false, access: { has: obj => "remove" in obj, get: obj => obj.remove }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _search_decorators, { kind: "method", name: "search", static: false, private: false, access: { has: obj => "search" in obj, get: obj => obj.search }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _install_decorators, { kind: "method", name: "install", static: false, private: false, access: { has: obj => "install" in obj, get: obj => obj.install }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _list_decorators, { kind: "method", name: "list", static: false, private: false, access: { has: obj => "list" in obj, get: obj => obj.list }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        static inject = ['agents', 'sessionQuery', 'typert'];
        dshHome = __runInitializers(this, _instanceExtraInitializers);
        runCli;
        installing = false;
        terminals = new Map();
        /**
         * @param ctx - Host context carrying Session reads and optional skill/preset services.
         * @param internals - test replacements for the DSH home and skills.sh CLI process.
         */
        constructor(ctx, internals = {}) {
            super(ctx, 'sessionSkillCatalog', { namespace: 'skills' });
            this.dshHome = internals.dshHome ?? resolveDshHome();
            this.runCli = internals.runCli ?? ((args, cwd, signal) => this.executeCli(args, cwd, signal));
            ctx.effect(() => async () => {
                const terminals = [...this.terminals.values()];
                this.terminals.clear();
                await Promise.allSettled(terminals.map(terminal => terminal.handle.terminate()));
            }, 'session skill catalog: interactive terminal cleanup');
        }
        /**
         * Start one unrestricted command in the host platform's native interactive shell.
         * @param request - Command and initial terminal dimensions.
         * @param signal - Caller cancellation for terminal startup.
         * @returns the caller-owned terminal identifier.
         */
        async terminalOpen(request, signal) {
            const command = request.command.trim();
            if (command.length === 0 || command.length > TERMINAL_INPUT_LIMIT) {
                throw new RemoteError('gateway/bad-request', 'terminal command must contain 1 to 16384 characters', {});
            }
            if (this.terminals.size >= 4) {
                throw new RemoteError('gateway/internal', 'too many Skills settings terminals are open', {});
            }
            const rows = request.rows ?? 24;
            const cols = request.cols ?? 100;
            if (!Number.isInteger(rows) || rows < 2 || rows > 200
                || !Number.isInteger(cols) || cols < 20 || cols > 400) {
                throw new RemoteError('gateway/bad-request', 'terminal dimensions are invalid', {});
            }
            const subprocess = this.ctx.get('subprocess');
            if (subprocess === undefined)
                throw new RemoteError('gateway/internal', 'subprocess service is unavailable', {});
            const declaredShell = process.platform === 'win32'
                ? process.env.ComSpec ?? 'cmd.exe'
                : process.env.SHELL ?? '/bin/sh';
            try {
                const shell = await subprocess.resolveExecutable(declaredShell, undefined, signal);
                const handle = await subprocess.spawnTerminal({
                    argv: [shell], cwd: homedir(), rows, cols, terminalType: 'xterm-256color', graceMs: 2_000, signal,
                    env: { NO_COLOR: '1', DISABLE_TELEMETRY: '1', DO_NOT_TRACK: '1' },
                });
                const id = randomUUID();
                const state = {
                    handle, output: '', baseOffset: 0, done: false, outputEnded: false,
                };
                this.terminals.set(id, state);
                handle.output.setEncoding('utf8');
                handle.output.on('data', (chunk) => {
                    state.output += chunk;
                    if (state.output.length <= TERMINAL_OUTPUT_LIMIT)
                        return;
                    const removed = state.output.length - TERMINAL_OUTPUT_LIMIT;
                    state.output = state.output.slice(removed);
                    state.baseOffset += removed;
                });
                handle.output.once('end', () => { state.outputEnded = true; });
                handle.output.once('error', (error) => {
                    state.error = String(error);
                    state.outputEnded = true;
                });
                void handle.done.then((outcome) => {
                    state.done = true;
                    state.exitCode = outcome.exitCode;
                }, (error) => {
                    state.done = true;
                    state.outputEnded = true;
                    state.error = String(error);
                });
                try {
                    await handle.write(`${command}\r`);
                }
                catch (error) {
                    this.terminals.delete(id);
                    await handle.terminate();
                    throw error;
                }
                return { id };
            }
            catch (error) {
                if (error instanceof RemoteError)
                    throw error;
                throw new RemoteError('gateway/internal', `terminal could not start: ${String(error)}`, {});
            }
        }
        /**
         * Read terminal output from the caller-owned character offset.
         * @param request - Terminal identifier and character offset.
         * @returns retained output and the next readable offset.
         */
        terminalRead(request) {
            const state = this.terminal(request.id);
            if (!Number.isInteger(request.offset) || request.offset < 0) {
                throw new RemoteError('gateway/bad-request', 'terminal output offset is invalid', {});
            }
            const lossy = request.offset < state.baseOffset;
            const start = lossy ? 0 : Math.min(request.offset - state.baseOffset, state.output.length);
            return {
                text: state.output.slice(start),
                nextOffset: state.baseOffset + state.output.length,
                lossy,
                exited: state.done && state.outputEnded,
                ...state.exitCode === undefined ? {} : { exitCode: state.exitCode },
                ...state.error === undefined ? {} : { error: state.error },
            };
        }
        /**
         * Write terminal input verbatim, including control characters.
         * @param request - Terminal identifier and input text.
         * @returns whether the terminal accepted the input.
         */
        async terminalWrite(request) {
            if (request.text.length > TERMINAL_INPUT_LIMIT) {
                throw new RemoteError('gateway/bad-request', 'terminal input is too long', {});
            }
            const state = this.terminal(request.id);
            if (state.done)
                throw new RemoteError('gateway/bad-request', 'terminal has exited', {});
            try {
                await state.handle.write(request.text);
                return { accepted: true };
            }
            catch (error) {
                throw new RemoteError('gateway/internal', `terminal input failed: ${String(error)}`, {});
            }
        }
        /**
         * Terminate and forget one Skills settings terminal.
         * @param request - Terminal identifier to close.
         * @returns whether an open terminal was closed.
         */
        async terminalClose(request) {
            const state = this.terminals.get(request.id);
            if (state === undefined)
                return { closed: false };
            this.terminals.delete(request.id);
            try {
                await state.handle.terminate();
                return { closed: true };
            }
            catch (error) {
                throw new RemoteError('gateway/internal', `terminal cleanup failed: ${String(error)}`, {});
            }
        }
        terminal(id) {
            const terminal = this.terminals.get(id);
            if (terminal === undefined)
                throw new RemoteError('gateway/bad-request', 'terminal was not found', {});
            return terminal;
        }
        /**
         * List skills installed directly in the user-global DSH skill root.
         * @returns the installed skill names in stable order.
         */
        async installed() {
            try {
                const enabled = await this.installedAt(join(this.dshHome, 'skills'));
                const disabled = await this.installedAt(join(this.dshHome, 'disabled-skills'));
                const skills = new Map(disabled.map(name => [name, false]));
                for (const name of enabled)
                    skills.set(name, true);
                return { skills: [...skills].sort(([a], [b]) => a.localeCompare(b)).map(([name, active]) => ({ name, enabled: active })) };
            }
            catch (error) {
                throw new RemoteError('gateway/internal', `installed skill listing failed: ${String(error)}`, {});
            }
        }
        /**
         * Enable or disable one global skill by moving it into or out of discovery.
         * @param request - Installed skill name and desired state.
         * @returns the persisted state.
         */
        async setEnabled(request) {
            const name = request.name.trim();
            if (name !== request.name || !SKILL_NAME.test(name) || typeof request.enabled !== 'boolean') {
                throw new RemoteError('gateway/bad-request', 'installed skill state is invalid', {});
            }
            const sourceRoot = join(this.dshHome, request.enabled ? 'disabled-skills' : 'skills');
            const targetRoot = join(this.dshHome, request.enabled ? 'skills' : 'disabled-skills');
            const source = join(sourceRoot, name);
            const target = join(targetRoot, name);
            const [sourceExists, targetExists] = await Promise.all([
                this.isInstalledSkill(source),
                this.isInstalledSkill(target),
            ]);
            if (!sourceExists) {
                if (targetExists)
                    return { name, enabled: request.enabled };
                throw new RemoteError('gateway/bad-request', `skill "${name}" is not installed`, {});
            }
            if (targetExists) {
                throw new RemoteError('gateway/internal', `skill "${name}" exists in both enabled and disabled directories`, {});
            }
            try {
                await mkdir(targetRoot, { recursive: true });
                await rename(source, target);
                return { name, enabled: request.enabled };
            }
            catch (error) {
                throw new RemoteError('gateway/internal', `skill "${name}" could not be ${request.enabled ? 'enabled' : 'disabled'}: ${String(error)}`, {});
            }
        }
        /**
         * Remove one global skill from discovery while retaining a recoverable backup.
         * @param request - Installed skill name to remove.
         * @returns whether an installed directory was moved to backup.
         */
        async remove(request) {
            const name = request.name.trim();
            if (name !== request.name || !SKILL_NAME.test(name)) {
                throw new RemoteError('gateway/bad-request', 'installed skill name is invalid', {});
            }
            const enabled = join(this.dshHome, 'skills', name);
            const disabled = join(this.dshHome, 'disabled-skills', name);
            const [enabledExists, disabledExists] = await Promise.all([
                this.isInstalledSkill(enabled),
                this.isInstalledSkill(disabled),
            ]);
            if (enabledExists && disabledExists) {
                throw new RemoteError('gateway/internal', `skill "${name}" exists in both enabled and disabled directories`, {});
            }
            const source = enabledExists ? enabled : disabledExists ? disabled : undefined;
            if (source === undefined)
                return { name, removed: false };
            const backupRoot = join(this.dshHome, 'skill-backups', `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`);
            try {
                await mkdir(backupRoot, { recursive: true });
                await rename(source, join(backupRoot, name));
                return { name, removed: true };
            }
            catch (error) {
                throw new RemoteError('gateway/internal', `skill "${name}" could not be removed: ${String(error)}`, {});
            }
        }
        async installedAt(root) {
            let entries;
            try {
                entries = await readdir(root, { withFileTypes: true });
            }
            catch (error) {
                if (error.code === 'ENOENT')
                    return [];
                throw error;
            }
            const names = await Promise.all(entries.filter(entry => SKILL_NAME.test(entry.name)).map(async (entry) => (await this.isInstalledSkill(join(root, entry.name)) ? entry.name : undefined)));
            return names.filter((name) => name !== undefined);
        }
        async isInstalledSkill(path) {
            try {
                return (await stat(join(path, 'SKILL.md'))).isFile();
            }
            catch (error) {
                if (error.code === 'ENOENT')
                    return false;
                throw error;
            }
        }
        /**
         * Search skills.sh through the maintained `skills` CLI.
         * @param request - validated search text.
         * @param signal - caller cancellation.
         * @returns matching installable skills.
         */
        async search(request, signal) {
            const query = request.query.trim();
            if (query.length === 0 || query.length > 100) {
                throw new RemoteError('gateway/bad-request', 'skill search query must contain 1 to 100 characters', {});
            }
            let output;
            try {
                output = await this.runCli(['--yes', 'skills', 'find', query], this.dshHome, signal);
            }
            catch (error) {
                throw new RemoteError('gateway/internal', `skills.sh search failed: ${String(error)}`, {});
            }
            return { skills: parseSearchOutput(output) };
        }
        /**
         * Install one skills.sh source into the user-global DSH skill root.
         * @param request - canonical owner/repository and skill selection.
         * @param signal - caller cancellation.
         * @returns the installed skill identity.
         */
        async install(request, signal) {
            const source = request.source.trim();
            if (!validInstallSource(source)) {
                throw new RemoteError('gateway/bad-request', 'skill source must be owner/repository@skill', {});
            }
            if (this.installing)
                throw new RemoteError('gateway/internal', 'another skill installation is already running', {});
            this.installing = true;
            let staging;
            try {
                staging = await mkdtemp(join(tmpdir(), 'dsh-skill-install-'));
                await this.runCli([
                    '--yes', 'skills', 'add', source,
                    '--agent', 'universal', '-y', '--copy',
                ], staging, signal);
                return await this.publishStagedSkill(join(staging, '.agents', 'skills'), source.slice(source.lastIndexOf('@') + 1));
            }
            catch (error) {
                if (error instanceof RemoteError)
                    throw error;
                throw new RemoteError('gateway/internal', `skill installation failed: ${String(error)}`, {});
            }
            finally {
                this.installing = false;
                if (staging !== undefined) {
                    try {
                        await rm(staging, { recursive: true, force: true });
                    }
                    catch (error) {
                        this.ctx.logger.warn(`skill installer could not remove staging directory: ${String(error)}`);
                    }
                }
            }
        }
        /**
         * List the user-invocable skills visible to one Session composition.
         * @param request - Session identity whose cwd and preset select the catalog view.
         * @param signal - caller lifetime carried by the Remote transport; admitted catalog reads retain their existing completion semantics.
         * @returns user-invocable skill metadata without loading skill bodies.
         * @throws RemoteError when the Session cannot be inspected or no registry can serve it.
         */
        async list(request, signal) {
            const env_1 = { stack: [], error: void 0, hasError: false };
            try {
                void signal;
                const { sessionId } = request;
                let cwd;
                let agentPreset;
                try {
                    const env_2 = { stack: [], error: void 0, hasError: false };
                    try {
                        const observation = __addDisposableResource(env_2, await this.ctx.sessionQuery.observeSession(sessionId), false);
                        if (observation.projections === undefined) {
                            throw new Error('skill catalog requires a projected Session observation');
                        }
                        cwd = observation.header.cwd;
                        agentPreset = observation.projections.values.agentPreset ?? undefined;
                    }
                    catch (e_1) {
                        env_2.error = e_1;
                        env_2.hasError = true;
                    }
                    finally {
                        __disposeResources(env_2);
                    }
                }
                catch (error) {
                    if (error instanceof SessionQueryError
                        && error.code === 'SESSION_QUERY_SESSION_NOT_FOUND') {
                        throw new RemoteError('session/not-found', `session "${sessionId}" not found`, { sessionId });
                    }
                    throw new RemoteError('gateway/internal', `session "${sessionId}" could not be inspected: ${String(error)}`, {});
                }
                if (cwd === undefined) {
                    throw new RemoteError('gateway/internal', `session "${sessionId}" has no project cwd`, {});
                }
                const live = this.ctx.agents.get(sessionId);
                const presets = presetServiceOf(this.ctx);
                const scoped = live === undefined ? undefined : presets?.serviceFor(live, 'skills');
                const skillRegistry = scoped ?? this.ctx.get('skills');
                if (skillRegistry === undefined) {
                    throw new RemoteError('gateway/internal', 'skill registry is absent: neither this session\'s agent preset nor the host composition mounts @deepseek-ai/dsh-skill', {});
                }
                const lease = __addDisposableResource(env_1, live === undefined ? await this.scopeFor(agentPreset) : undefined, true);
                const scope = live ?? lease?.key;
                try {
                    const skills = (await skillRegistry.list({ cwd, scope })).filter(isUserInvocable);
                    return {
                        skills: skills.map(skill => ({
                            name: skill.name,
                            ...skill.path === undefined ? {} : { path: skill.path },
                            description: skill.description,
                            ...skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse },
                            modelInvocable: skill.invocation.modelInvocable,
                        })),
                    };
                }
                catch (error) {
                    throw new RemoteError('gateway/internal', `skill listing failed: ${String(error)}`, {});
                }
            }
            catch (e_2) {
                env_1.error = e_2;
                env_1.hasError = true;
            }
            finally {
                const result_1 = __disposeResources(env_1);
                if (result_1)
                    await result_1;
            }
        }
        /** Resolve a live or standing preset scope without creating an Agent. */
        async scopeFor(agentPreset) {
            const presets = presetServiceOf(this.ctx);
            if (presets === undefined)
                return undefined;
            try {
                return await presets.acquireScope(agentPreset);
            }
            catch {
                // An unknown or unusable recorded preset falls back to the global registry.
                return undefined;
            }
        }
        /** Run one shell-free npx invocation with bounded output and no Harness credentials. */
        async executeCli(args, cwd, signal) {
            const subprocess = this.ctx.get('subprocess');
            if (subprocess === undefined)
                throw new Error('subprocess service is unavailable');
            const deadline = AbortSignal.timeout(CLI_TIMEOUT_MS);
            const combined = AbortSignal.any([signal, deadline]);
            const executable = await subprocess.resolveExecutable('npx', undefined, combined);
            const handle = subprocess.spawn({
                argv: [executable, ...args],
                cwd,
                stdio: {
                    stdin: 'ignore',
                    stdout: { maxBytes: CLI_OUTPUT_LIMIT },
                    stderr: { maxBytes: CLI_OUTPUT_LIMIT },
                },
                env: { DISABLE_TELEMETRY: '1', DO_NOT_TRACK: '1' },
                graceMs: 2_000,
                signal: combined,
            });
            const outcome = await handle.done;
            const stdout = handle.collected.stdout?.readFrom(0).text ?? '';
            const stderr = handle.collected.stderr?.readFrom(0).text.trim() ?? '';
            if (combined.aborted)
                throw new Error(deadline.aborted ? 'skills CLI timed out' : 'skills CLI was cancelled');
            if (outcome.exitCode !== 0)
                throw new Error(stderr || `skills CLI exited with code ${String(outcome.exitCode)}`);
            return stdout;
        }
        /** Publish the requested staged directory with a recoverable backup when replacing it. */
        async publishStagedSkill(stagedRoot, expectedName) {
            let entries;
            try {
                entries = await readdir(stagedRoot, { withFileTypes: true });
            }
            catch (error) {
                if (error.code === 'ENOENT') {
                    throw new Error('skills CLI completed without producing a DSH-compatible skill');
                }
                throw error;
            }
            const skills = entries.filter(entry => entry.isDirectory() && SKILL_NAME.test(entry.name));
            const skill = skills.find(entry => entry.name.toLowerCase() === expectedName.toLowerCase());
            if (skill === undefined || skills.length !== 1) {
                throw new Error(`skills CLI did not produce exactly the requested skill "${expectedName}"`);
            }
            const targetRoot = join(this.dshHome, 'skills');
            const backupRoot = join(this.dshHome, 'skill-backups', `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`);
            await mkdir(targetRoot, { recursive: true });
            const name = basename(skill.name);
            const source = join(stagedRoot, name);
            const pending = join(targetRoot, `.install-${name}-${randomUUID()}`);
            const target = join(targetRoot, name);
            const disabledTarget = join(this.dshHome, 'disabled-skills', name);
            const backup = join(backupRoot, name);
            const skillFile = await stat(join(source, 'SKILL.md'));
            if (!skillFile.isFile())
                throw new Error(`installed skill "${name}" has no SKILL.md`);
            await cp(source, pending, { recursive: true });
            const [targetExists, disabledExists] = await Promise.all([
                this.isInstalledSkill(target),
                this.isInstalledSkill(disabledTarget),
            ]);
            if (targetExists && disabledExists)
                throw new Error(`skill "${name}" exists in both enabled and disabled directories`);
            const replaced = targetExists ? target : disabledExists ? disabledTarget : undefined;
            if (replaced !== undefined) {
                await mkdir(backupRoot, { recursive: true });
                await rename(replaced, backup);
            }
            try {
                await rename(pending, target);
            }
            catch (error) {
                await rm(pending, { recursive: true, force: true });
                if (replaced !== undefined)
                    await rename(backup, replaced);
                throw error;
            }
            return { installed: [name], backedUp: replaced === undefined ? [] : [name] };
        }
    };
})();
export { SessionSkillCatalog };
/**
 * Parse stable owner/repository@skill identifiers from CLI presentation output.
 * @param output - Raw skills CLI presentation output.
 * @returns unique catalog entries in presentation order.
 */
export function parseSearchOutput(output) {
    const plain = output.replace(ANSI_ESCAPE, '');
    const results = new Map();
    for (const match of plain.matchAll(SEARCH_RESULT)) {
        const source = match[1];
        const name = match[2];
        if (source === undefined || name === undefined || results.has(source))
            continue;
        results.set(source, { source, name, url: `https://skills.sh/${source.replace('@', '/')}` });
    }
    return [...results.values()];
}
/** Accept only one exact CLI catalog identifier. */
function validInstallSource(source) {
    const part = '[a-z0-9][a-z0-9_.-]*';
    return new RegExp(`^${part}\\/${part}@${part}$`, 'i').test(source);
}
export default SessionSkillCatalog;
//# sourceMappingURL=skill-catalog.js.map