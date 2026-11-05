// The session's mode (spec "Main screen"): fullscreen or the main screen, from `isFullscreen`
// (`command.run`'s `presentation`, or `viewport` on any drawing). Fixed for the session:
// the first value reported is kept in $.state (`marks.fullscreen`), every hook reads it from there. Pure.

/** What the session's mode is: the stored one, else what this drawing's viewport says (undefined: unknown). */
export const modeOf = (stored: boolean | null | undefined, seen: boolean | undefined): boolean | undefined =>
  typeof stored === 'boolean' ? stored : seen

/** The value to store, or undefined when there is nothing to write: a mode already stored is never changed. */
export const modeToStore = (stored: boolean | null | undefined, seen: boolean | undefined): boolean | undefined =>
  typeof stored === 'boolean' ? undefined : seen
