/** Structural face shared by the composed preset roster and the legacy declarative registry. */
/** Read whichever preset service the composition mounts, preferring the composed roster.
 * @param ctx - the host context whose composition provides one of the preset services.
 * @returns the mounted preset service face, or undefined when the composition mounts none.
 */
export function presetServiceOf(ctx) {
    return ctx.get('agentPresets')
        ?? ctx.get('agentPresetRegistry');
}
//# sourceMappingURL=preset-service.js.map