export function buildBatchToken(ids: string[]): string {
  return Buffer.from(JSON.stringify(ids)).toString("base64url")
}

export function parseBatchToken(token: string): string[] {
  try {
    return JSON.parse(Buffer.from(token, "base64url").toString())
  } catch {
    return []
  }
}
