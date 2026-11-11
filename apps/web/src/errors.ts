/** Human-readable message from an oRPC / network error. */
export function errorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const e = error as { message?: string; data?: { issues?: { message: string }[] } };
    if (e.data?.issues?.length) return e.data.issues.map((i) => i.message).join(', ');
    if (e.message) return e.message;
  }
  return 'Something went wrong.';
}
