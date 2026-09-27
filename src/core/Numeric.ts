/**
 * `value` confined to the inclusive range [`low`, `high`].
 *
 * One home for an idiom the camera's elevation guard and dolly clamp, the
 * depth-cue radius clamp, the renderer's fade and bucket clamps and the context
 * menu's viewport clamp all spell out.
 */
export function clamp(value: number, low: number, high: number): number {
    return Math.min(Math.max(value, low), high);
}
