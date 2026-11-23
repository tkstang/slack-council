export const SLACK_TIMESTAMP = /^\d{1,16}\.\d{1,6}$/u;

export function compareSlackTimestamps(a: string, b: string): number {
  const [aSec = '0', aFrac = ''] = a.split('.');
  const [bSec = '0', bFrac = ''] = b.split('.');
  const seconds = BigInt(aSec) - BigInt(bSec);
  if (seconds !== 0n) return seconds < 0n ? -1 : 1;
  return aFrac.padEnd(6, '0').localeCompare(bFrac.padEnd(6, '0'));
}
