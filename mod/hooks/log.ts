// The mod's debug log (`claude --debug`), shared by the hooks modules.
import type { EngineInterface } from 'claude-code'

/** One debug log line, prefixed `marks:`. */
export function log($: EngineInterface, text: string) {
  $.ui.log(`marks: ${text}`, { to: 'debug' })
}

/** An error's message, or the thrown value as text. */
export function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
