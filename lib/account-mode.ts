export type AccountMode = "personal" | "business"

export function resolveAccountMode(value: unknown): AccountMode {
  return value === "business" ? "business" : "personal"
}

export function isBusinessAccount(value: unknown): boolean {
  return resolveAccountMode(value) === "business"
}
