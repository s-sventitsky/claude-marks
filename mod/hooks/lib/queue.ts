// The labeller queue's policy: exchange ids waiting for a labeller call, conversation order.
// register.tsx holds the queue (a module variable) and makes the calls. Pure.
import type { ChainView, ConversationFile } from '../../types/index'
import { backOnChain, gapRun, liveView, mergeBack } from './chain'
import { settle } from './labeller'
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

/**
 * The gap rule on load (chain.ts gapRun) over the merged file: a short run goes ahead of what
 * is queued; a long one is the record of exchanges left unlabelled. Hidden, queued and running
 * exchanges are no gap.
 */
export const refill = (
  file: ConversationFile,
  o: { queue: readonly string[]; running: string | null | undefined; hidden: readonly string[]; fresh: boolean },
): { queue: string[]; unlabelled: string[] } => {
  const gap = gapRun(file, [...o.hidden, ...waiting(o.queue, o.running)], o.fresh)
  return { queue: [...gap.queue, ...o.queue], unlabelled: gap.left }
}

/** P1: a new chain view puts exchanges a rewind hid while they waited back at the end of the queue (chain.ts backOnChain). */
export const requeue = (
  file: ConversationFile,
  queue: readonly string[],
  running: string | null | undefined,
  before: ChainView | null,
  after: ChainView,
): string[] => [...queue, ...backOnChain(file, before, after, waiting(queue, running))]

/**
 * A call's outcome (labeller.ts settle) placed against the live chain (current thread,
 * threads), then put back into the whole file. `retry`: keep the exchange at the head.
 */
export const settleLive = (
  file: ConversationFile,
  hidden: readonly string[],
  id: string,
  result: Parameters<typeof settle>[2],
  model: string,
): { file: ConversationFile; retry: boolean } => {
  const view = liveView(file, hidden)
  const s = settle(view, id, result, model)
  return { file: view === file ? s.file : mergeBack(file, s.file), retry: s.retry }
}
