// Where claude-marks keeps its files. Pure: the adapter reads the env and passes it in.

export type ConfigEnv = { CLAUDE_CONFIG_DIR?: string; USERPROFILE?: string; HOME?: string }

const slash = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')

/** `CLAUDE_CONFIG_DIR`, else `<home>/.claude` (home from HOME, then USERPROFILE). Forward slashes. */
export const configDir = (env: ConfigEnv): string | undefined => {
  if (env.CLAUDE_CONFIG_DIR) return slash(env.CLAUDE_CONFIG_DIR)
  const home = env.HOME || env.USERPROFILE
  return home ? `${slash(home)}/.claude` : undefined
}

export const dataPath = (config: string, sessionId: string): string => `${config}/claude-marks/${sessionId}.json`
