// Ticket 02: one labeller call. The rules go first and cached; the dynamic part names the
// exchange to label against the (live) file. register.tsx's drain decides when to call.
import type { EngineInterface } from 'claude-code'
import type { ConversationFile } from '../types/index'
import { buildDynamic } from './lib/labeller'
import type { RowIndex } from './lib/rows'
import { RULES } from './lib/rules'

/** Hardcoded in the MVP; `label.model` stores this alias (the result names no model). */
export const MODEL = 'haiku'

/** Asks the model to label exchange `id` of `file`. Rejects when the engine refuses to send it (a blocked model). */
export async function askLabeller($: EngineInterface, file: ConversationFile, index: RowIndex, id: string) {
  return $.model.complete({
    model: MODEL,
    effort: 'low',
    prompt: [{ text: RULES, cache: true }, { text: buildDynamic(file, index, id) }],
    maxTokens: 400,
    timeoutMs: 15_000,
  })
}
