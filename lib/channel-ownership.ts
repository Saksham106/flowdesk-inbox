export function canReconnectChannel(existingTenantId: string, sessionTenantId: string): boolean {
  return existingTenantId === sessionTenantId
}
