/**
 * IP forwarding for the auth mount. Glaze runs same-origin with no proxy, so there is no legitimate
 * inbound `X-Forwarded-For` — which leaves Better Auth's per-IP rate limiter without a key. This
 * resolves the **trusted peer address** from the server and stamps it onto the request the auth
 * handler sees, so the limiter keys per real client.
 *
 * The shim always **owns** the `x-forwarded-for` header so a client can never forge its own rate-limit
 * bucket: it stamps the socket peer address when known, and otherwise **strips** any client-supplied
 * value (Better Auth trusts a lone `x-forwarded-for` when no `trustedProxies` are configured, so a
 * passed-through client value would be spoofable). When the peer address is unavailable — e.g. the
 * Node HTTP adapter does not expose it — the header is removed and Better Auth applies its own safe
 * fallback (localhost in dev/test, or a shared per-path bucket in production).
 */

/** The minimal server surface used to resolve a request's peer address (Bun's `Server.requestIP`). */
export interface PeerAddressSource {
	requestIP?(request: Request): { address?: string } | null;
}

/**
 * Returns a request whose `x-forwarded-for` header is under Glaze's control: set to the trusted peer
 * IP when resolvable, otherwise stripped of any client-supplied value.
 *
 * @param request - The incoming request (its identity is used to look up the peer socket).
 * @param server - The server that can resolve the peer address, if any.
 * @returns The request the auth handler should process.
 */
export function forwardTrustedIp(
	request: Request,
	server: PeerAddressSource | null | undefined,
): Request {
	const peerIp = resolvePeerIp(request, server);

	// Nothing to control: no trusted peer to stamp and no client value to strip.
	if (!peerIp && !request.headers.has('x-forwarded-for')) return request;

	const headers = new Headers(request.headers);
	if (peerIp) {
		headers.set('x-forwarded-for', peerIp);
	} else {
		headers.delete('x-forwarded-for');
	}
	return rebuildRequest(request, headers);
}

/**
 * Rebuilds a request with a new header set, preserving method and body.
 *
 * Reconstructs from the URL with an explicit init rather than `new Request(request, { headers })`,
 * because the latter is unreliable for *removing* a header on Bun — the source request's headers leak
 * back onto the copy, so a stripped `x-forwarded-for` would reappear.
 *
 * @param request - The original request (source of URL, method, and body).
 * @param headers - The header set the rebuilt request should carry.
 * @returns A new request with the given headers.
 */
function rebuildRequest(request: Request, headers: Headers): Request {
	const init: RequestInit = { method: request.method, headers };
	if (request.body) {
		init.body = request.body;
		// Required by the platform when streaming a body into a new Request.
		(init as { duplex?: 'half' }).duplex = 'half';
	}
	return new Request(request.url, init);
}

/**
 * Resolves the socket peer address for a request, tolerating adapters that don't support it.
 *
 * @param request - The incoming request.
 * @param server - The server that can resolve the peer address, if any.
 * @returns The peer IP, or `undefined` when it cannot be determined.
 */
function resolvePeerIp(
	request: Request,
	server: PeerAddressSource | null | undefined,
): string | undefined {
	try {
		return server?.requestIP?.(request)?.address ?? undefined;
	} catch {
		// The Node adapter's `requestIP` throws; degrade to Better Auth's own IP fallback.
		return undefined;
	}
}
