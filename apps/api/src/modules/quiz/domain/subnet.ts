import { isIP } from 'node:net';


function ipToBytes(ip: string): number[] | null {
  const kind = isIP(ip);
  if (kind === 4) {
    return ip.split('.').map((p) => Number.parseInt(p, 10));
  }
  if (kind === 6) {
    let addr = ip.toLowerCase();
    const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return mapped[1]!.split('.').map((p) => Number.parseInt(p, 10));
    const zoneIdx = addr.indexOf('%');
    if (zoneIdx >= 0) addr = addr.slice(0, zoneIdx);
    const [head, tail] = addr.split('::');
    const headParts = head ? head.split(':').filter((p) => p.length > 0) : [];
    const tailParts = tail ? tail.split(':').filter((p) => p.length > 0) : [];
    const expand = (parts: string[]): number[] => {
      const out: number[] = [];
      for (const p of parts) {
        if (p.includes('.')) {
          const v4 = p.split('.').map((x) => Number.parseInt(x, 10));
          out.push(((v4[0]! << 8) | v4[1]!), ((v4[2]! << 8) | v4[3]!));
        } else {
          out.push(Number.parseInt(p, 16));
        }
      }
      return out;
    };
    const headGroups = expand(headParts);
    const tailGroups = expand(tailParts);
    const missing = 8 - headGroups.length - tailGroups.length;
    if (missing < 0) return null;
    const groups = [...headGroups, ...Array.from({ length: missing }, () => 0), ...tailGroups];
    if (groups.length !== 8) return null;
    const bytes: number[] = [];
    for (const g of groups) bytes.push((g >> 8) & 0xff, g & 0xff);
    return bytes;
  }
  return null;
}

function bytesToBigInt(bytes: number[]): bigint {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
}

export interface SubnetEntry { base: bigint; bits: number; totalBits: number }

export function parseSubnetEntry(raw: string): SubnetEntry | null {
  const entry = raw.trim();
  if (!entry) return null;
  const [ipPart, prefixPart, ...rest] = entry.split('/');
  if (rest.length > 0 || !ipPart) return null;
  const bytes = ipToBytes(ipPart);
  if (!bytes) return null;
  const totalBits = bytes.length * 8;
  let bits = totalBits;
  if (prefixPart !== undefined) {
    if (!/^\d+$/.test(prefixPart)) return null;
    bits = Number.parseInt(prefixPart, 10);
    if (bits < 0 || bits > totalBits) return null;
  }
  return { base: bytesToBigInt(bytes), bits, totalBits };
}

export function isValidSubnetList(subnet: string): boolean {
  const parts = subnet.split(',');
  if (!parts.some((p) => p.trim().length > 0)) return false;
  return parts.every((p) => parseSubnetEntry(p) !== null);
}

export function ipMatchesSubnetList(ip: string, subnet: string): boolean {
  const ipBytes = ipToBytes(ip);
  if (!ipBytes) return false;
  const value = bytesToBigInt(ipBytes);
  for (const part of subnet.split(',')) {
    const entry = parseSubnetEntry(part);
    if (!entry) continue;
    if (entry.totalBits !== ipBytes.length * 8) continue;
    if (entry.bits === 0) return true;
    const shift = BigInt(entry.totalBits - entry.bits);
    if ((value >> shift) === (entry.base >> shift)) return true;
  }
  return false;
}
