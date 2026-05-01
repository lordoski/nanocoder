const LOCAL_HOSTNAMES = new Set([
	'localhost',
	'127.0.0.1',
	'0.0.0.0',
	'[::1]',
	'::1',
]);

/**
 * Check if an IP address falls in a private/local range:
 *   - 10.x.x.x        (Class A private)
 *   - 172.16.x.x–31   (Class B private)
 *   - 192.168.x.x     (Class C private / LAN)
 *   - 169.254.x.x     (link-local)
 */
function isPrivateIP(hostname: string): boolean {
	const parts = hostname.split('.');
	if (parts.length !== 4) {
		return false;
	}
	const [a, b] = parts.map(Number);
	if (Number.isNaN(a) || Number.isNaN(b)) {
		return false;
	}
	// 10.0.0.0/8
	if (a === 10) return true;
	// 172.16.0.0/12
	if (a === 172 && b >= 16 && b <= 31) return true;
	// 192.168.0.0/16
	if (a === 192 && b === 168) return true;
	// 169.254.0.0/16 (link-local)
	if (a === 169 && b === 254) return true;
	return false;
}

/**
 * Check if a URL points to a local server.
 * Matches: localhost, 127.x.x.x, ::1, and private IP ranges
 * (10.x, 172.16-31.x, 192.168.x, 169.254.x).
 */
export function isLocalURL(url: string): boolean {
	try {
		const parsed = new URL(url);
		if (parsed.hostname) {
			if (LOCAL_HOSTNAMES.has(parsed.hostname)) {
				return true;
			}
			if (isPrivateIP(parsed.hostname)) {
				return true;
			}
			return false;
		}
	} catch {
		// Fall through to string matching
	}
	// Fallback for malformed URLs or empty hostname: check the raw string
	return (
		url.includes('localhost') ||
		url.includes('127.0.0.1') ||
		url.includes('0.0.0.0') ||
		url.includes('::1') ||
		url.includes('192.168.') ||
		url.includes('10.') ||
		url.includes('172.16.')
	);
}
