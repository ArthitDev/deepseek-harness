import { deepEqual } from '@deepseek-ai/cosmokit';
import { isJsExpr } from "./utils.js";
function isSchemastery(schema) {
    return schema?.['~standard'].vendor === 'schemastery';
}
function isRecord(value) {
    if (!value || typeof value !== 'object' || isJsExpr(value))
        return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
function equal(a, b, schema, ancestors) {
    if (schema?.meta?.volatile)
        return true;
    if (schema?.type !== 'object' || !schema.dict || ancestors.has(schema))
        return deepEqual(a, b, true);
    const left = a ?? schema.meta?.default;
    const right = b ?? schema.meta?.default;
    if (!isRecord(left) || !isRecord(right))
        return deepEqual(left, right, true);
    const { dict } = schema;
    ancestors.add(schema);
    try {
        return Object.keys({ ...left, ...right }).every(key => equal(left[key], right[key], Object.hasOwn(dict, key) ? dict[key] : undefined, ancestors));
    }
    finally {
        ancestors.delete(schema);
    }
}
/**
 * Compare two raw configs, treating schema-declared volatile fields at fixed object paths as equal and absent objects as their schema default.
 * Schema backedges, expressions, unknown fields and opaque values keep strict raw equality; an absent or non-Schemastery schema compares everything raw.
 * @param previous - previous raw config.
 * @param next - next raw config.
 * @param schema - the plugin's config schema.
 * @returns Whether the configs differ at most in volatile fields, without evaluating expressions, validating config or modifying inputs.
 * @internal
 */
export function equalExceptVolatile(previous, next, schema) {
    return isSchemastery(schema) ? equal(previous, next, schema, new Set()) : deepEqual(previous, next, true);
}
//# sourceMappingURL=diff.js.map