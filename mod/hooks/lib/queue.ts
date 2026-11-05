// The labeller queue's policy: exchange ids waiting for a labeller call, conversation order.
// register.tsx holds the queue (a module variable) and makes the calls. Pure.
import type { ConversationFile } from '../../types/index'
import { exchangeById } from './model'

/** What the labeller does with the head of its queue: nothing, drop it, or label it. */
export type HeadStep = { kind: 'idle' } | { kind: 'drop'; id: string } | { kind: 'label'; id: string }

/**
 * The head's step. Labelled already, or gone from the file: dropped. Hidden by a rewind:
 * dropped too; it stays pending and is queued again if its fork turns live (chain.ts backOnChain).
 */
export const headStep = (file: ConversationFile, queue: readonly string[], hidden: readonly string[]): HeadStep => {
  const id = queue[0]
  if (id === undefined) return { kind: 'idle' }
  const x = exchangeById(file, id)
  if (!x || x.label.status === 'done' || hidden.includes(id)) return { kind: 'drop', id }
  return { kind: 'label', id }
}

/** The queue once the head's call has settled: the head leaves unless the outcome is a retry. */
export const afterSettle = (queue: readonly string[], retry: boolean): string[] => (retry ? [...queue] : queue.slice(1))

/** A finished turn's exchange joins the end of the queue, once. */
export const enqueue = (queue: readonly string[], id: string | null | undefined): string[] =>
  id && !queue.includes(id) ? [...queue, id] : [...queue]

/** Exchanges the labeller has already: queued, then the running turn's. The gap rule and the re-queue skip them. */
export const waiting = (queue: readonly string[], running: string | null | undefined): string[] => [...queue, ...(running ? [running] : [])]
