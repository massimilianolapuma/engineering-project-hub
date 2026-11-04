/** Classification of a non-2xx HTTP status, shared by the collector and the notifier. */
export type HttpClass =
  'not-authorised' | 'not-found' | 'rate-limited' | 'rejected' | 'too-large' | 'error';

export function classifyStatus(status: number): HttpClass {
  if (status === 401 || status === 403) return 'not-authorised';
  if (status === 404) return 'not-found';
  if (status === 429) return 'rate-limited';
  if (status === 400 || status === 422) return 'rejected';
  if (status === 413) return 'too-large';
  return 'error';
}
