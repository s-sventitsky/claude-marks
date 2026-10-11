export type Markers = 'divider' | 'off'
export type View = { kind: 'list' } | { kind: 'portal'; n: number; from: 'list' | 'deny' }

declare module 'claude-code' {
  interface PluginState {
    'marks-proto': {
      markers: Markers
      view: View
      forceMain: boolean
      tick: number
      where: number
    }
  }
}
