// The session's mode (ticket 08): one value in $.state (`marks.fullscreen`), set from the first
// `isFullscreen` heard and never changed. `/marks` stores `presentation.isFullscreen` at once;
// a drawing can't write $.state, so render hooks note their viewport and the timer stores it.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import { modeOf, modeToStore } from './lib/mode'

const modeA = atom({ plugin: 'marks', key: 'fullscreen' } as const, null)

/** The last `viewport.isFullscreen` a drawing reported. Lost on reload; the stored mode is not. */
let seen: boolean | undefined

/** A render hook reports its viewport; the next timer tick stores it if no mode is stored yet. */
export function noteMode(isFullscreen: boolean | undefined) {
  if (typeof isFullscreen === 'boolean') seen = isFullscreen
}

/** Stores `isFullscreen` as the session's mode unless one is stored. Not from a render hook. */
export async function fixMode($: EngineInterface, isFullscreen: boolean | undefined = seen) {
  const v = modeToStore(await read($, modeA), isFullscreen)
  if (v === undefined) return
  await update($, modeA, cur => (typeof cur === 'boolean' ? cur : v))
}

/**
 * The session's mode: true fullscreen, false the main screen, undefined unknown.
 * `isFullscreen` (this drawing's viewport) stands in until a mode is stored.
 * Read while drawing, it redraws the reader when the mode is stored.
 */
export async function readMode($: EngineInterface, isFullscreen: boolean | undefined): Promise<boolean | undefined> {
  return modeOf(await read($, modeA), isFullscreen)
}
