/** Identity checks at the plugin-export and lazy-builder boundaries. */
/**
 * Recognize the native Schemastery graph protocol without invoking a validator or serialization hook.
 * @param value - plugin Config export or lazy-builder result.
 * @returns whether native schema fields can be inspected.
 */
export function isNativeConfigSchema(value) {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function'))
        return false;
    const meta = Reflect.get(value, 'meta');
    return Reflect.get(value, Symbol.for('schemastery')) === true
        && typeof Reflect.get(value, 'type') === 'string'
        && meta !== null && typeof meta === 'object';
}
//# sourceMappingURL=native.js.map