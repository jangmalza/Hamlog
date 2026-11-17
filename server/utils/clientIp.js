import { BlockList, isIP } from 'node:net';

// Addresses that can only belong to a local reverse proxy or tunnel hop
// (cloudflared on the host reaching the container through Docker, a LAN proxy).
// IPv4-mapped IPv6 addresses such as ::ffff:127.0.0.1 match the IPv4 rules.
const internalAddresses = new BlockList();
internalAddresses.addSubnet('127.0.0.0', 8, 'ipv4');
internalAddresses.addSubnet('10.0.0.0', 8, 'ipv4');
internalAddresses.addSubnet('172.16.0.0', 12, 'ipv4');
internalAddresses.addSubnet('192.168.0.0', 16, 'ipv4');
internalAddresses.addSubnet('169.254.0.0', 16, 'ipv4');
internalAddresses.addAddress('::1', 'ipv6');
internalAddresses.addSubnet('fc00::', 7, 'ipv6');
internalAddresses.addSubnet('fe80::', 10, 'ipv6');

export const isInternalAddress = (address) => {
    const family = isIP(String(address ?? ''));
    if (!family) return false;
    return internalAddresses.check(address, family === 4 ? 'ipv4' : 'ipv6');
};

// When Express only sees an internal hop (TRUST_PROXY unset behind the tunnel),
// every visitor would share one address. Cloudflare's CF-Connecting-IP carries
// the visitor address; it is only honoured from internal peers, which cannot be
// reached from the internet when the port is bound to 127.0.0.1.
export const resolveClientIp = (req) => {
    const ip = String(req.ip ?? req.socket?.remoteAddress ?? '');
    if (!isInternalAddress(ip)) return ip;

    const forwarded = String(req.get?.('cf-connecting-ip') ?? '').trim();
    return isIP(forwarded) ? forwarded : ip;
};
