export type AgentToolRiskDeclaration = {
  executionMode?: unknown
  name?: unknown
  risk?: unknown
}

/**
 * JSON Schema supplies the structural bounds. This cross-field check is kept
 * separate so the CLI can prove the signed risk contract independently and
 * emit a stable developer-facing error before packaging.
 */
export function assertAgentToolRiskDeclarations(tools: AgentToolRiskDeclaration[]): void {
  for (const tool of tools) {
    const name = typeof tool.name === 'string' ? tool.name : '<unknown>'
    if (tool.executionMode === 'SUPERVISED_WRITE' && !tool.risk) {
      throw new Error(`supervised agent tool ${name} must declare bounded risk`)
    }
    if (tool.executionMode === 'READ_ONLY' && tool.risk) {
      throw new Error(`read-only agent tool ${name} cannot declare write risk`)
    }
  }
}
