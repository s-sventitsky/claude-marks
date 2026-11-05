// The session's mode (spec "Main screen"): fullscreen or the main screen, from `isFullscreen`
// (`command.run`'s `presentation`, or `viewport` on any drawing). Fixed for the session:
// the first value reported is kept in $.state (`marks.fullscreen`), every hook reads it from there. Pure.

/** The session's mode: true fullscreen, false the main screen, undefined unknown (nothing heard yet). */
export type Mode = boolean | undefined

/** The mode as $.state holds it: null until one is stored. */
export type StoredMode = boolean | null

/** What the session's mode is: the stored one, else what this drawing's viewport says. */
export const modeOf = (stored: StoredMode | undefined, seen: Mode): Mode => (typeof stored === 'boolean' ? stored : seen)

/** The value to store, or undefined when there is nothing to write: a mode already stored is never changed. */
export const modeToStore = (stored: StoredMode | undefined, seen: Mode): Mode => (typeof stored === 'boolean' ? undefined : seen)
