/** Configuration-free snapshots captured before a failed startup disposes its plugins. */
import { Context } from '@deepseek-ai/cordis';
function stateName(state) {
    const names = {
        0: 'pending', 1: 'loading', 2: 'active', 3: 'failed', 4: 'disposed', 5: 'unloading',
    };
    return names[state];
}
function pluginState(ctx, entry) {
    let state;
    try {
        state = entry.disabled ? 'disabled' : entry.fiber === undefined ? 'failed' : stateName(entry.fiber.state);
    }
    catch (_error) {
        // The activation diagnostic owns the disabled-expression error.
        state = 'failed';
    }
    let version = 'unknown';
    const source = entry.parent.tree.ctx.baseUrl;
    try {
        if (source !== undefined)
            version = ctx.get('pluginPackages')?.packageOf(entry.options.name, source)?.version ?? 'unknown';
    }
    catch (_error) {
        // Missing or damaged metadata must not replace the startup failure.
    }
    const fiber = entry.fiber;
    return {
        id: entry.id, module: entry.options.name, version, state, source: source ?? 'unknown',
        missing: state === 'pending' && fiber !== undefined
            ? Object.keys(fiber.inject).filter(name => fiber.ctx.get(name) === undefined) : [],
    };
}
/**
 * Capture Loader state and registered service ownership before teardown.
 * Providers that never registered cannot be inferred from their package names.
 * @param ctx - Live application context with its Loader still mounted.
 * @returns At most 256 plugin rows and 256 missing-service observations, with omission counts.
 */
export function captureStartupComposition(ctx) {
    const entries = [...ctx.loader.entries()];
    const rows = entries.map(entry => ({ entry, state: pluginState(ctx, entry) }));
    // Inactive rows precede healthy rows so bounded reports retain the failure context.
    rows.sort((a, b) => Number(a.state.state === 'active') - Number(b.state.state === 'active'));
    const services = [];
    let omittedServices = 0;
    const store = ctx.reflect.store;
    for (const { entry, state } of rows) {
        const fiber = entry.fiber;
        if (fiber === undefined)
            continue;
        for (const service of state.missing) {
            if (services.length === 256) {
                omittedServices++;
                continue;
            }
            const scope = fiber.ctx[Context.isolate][service];
            const providers = [];
            for (const key of Object.getOwnPropertySymbols(store)) {
                const impl = store[key];
                if (impl?.name !== service)
                    continue;
                providers.push({
                    entry: impl.ctx.fiber.entry?.id ?? 'unknown', state: stateName(impl.ctx.fiber.state),
                    visibility: key === scope ? 'same-scope' : 'other-scope',
                });
            }
            services.push({ consumer: state.id, service, providers });
        }
    }
    return {
        plugins: rows.slice(0, 256).map(row => row.state), services,
        omittedPlugins: Math.max(0, rows.length - 256), omittedServices,
    };
}
//# sourceMappingURL=startup-diagnostics.js.map