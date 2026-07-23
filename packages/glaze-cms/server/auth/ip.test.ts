import { expect, test } from '#harness';

import { forwardTrustedIp, type PeerAddressSource } from './ip.ts';

/** A request that arrives claiming its own (spoofable) forwarded IP. */
function spoofingRequest(): Request {
	return new Request('http://localhost/api/auth/sign-in/email', {
		method: 'POST',
		headers: { 'x-forwarded-for': '1.2.3.4' },
	});
}

test('stamps the trusted peer address, overwriting a client-supplied x-forwarded-for', () => {
	const server: PeerAddressSource = { requestIP: () => ({ address: '203.0.113.7' }) };
	const forwarded = forwardTrustedIp(spoofingRequest(), server);
	expect(forwarded.headers.get('x-forwarded-for')).toBe('203.0.113.7');
});

test('strips a client-supplied x-forwarded-for when no peer address is available', () => {
	// No trusted peer (e.g. the Node adapter) ⇒ the client value must NOT be trusted through.
	const forwarded = forwardTrustedIp(spoofingRequest(), null);
	expect(forwarded.headers.get('x-forwarded-for')).toBeNull();
});

test('tolerates a server whose requestIP throws (the Node adapter) and still strips the claim', () => {
	const server: PeerAddressSource = {
		requestIP: () => {
			throw new Error('unsupported');
		},
	};
	const forwarded = forwardTrustedIp(spoofingRequest(), server);
	expect(forwarded.headers.get('x-forwarded-for')).toBeNull();
});

test('passes the request through untouched when there is nothing to control', () => {
	const request = new Request('http://localhost/api/auth/get-session');
	const forwarded = forwardTrustedIp(request, null);
	// No peer to stamp and no client claim to strip ⇒ same request, no forwarded header.
	expect(forwarded).toBe(request);
	expect(forwarded.headers.get('x-forwarded-for')).toBeNull();
});

test('preserves the method and body when reconstructing the request', async () => {
	const request = new Request('http://localhost/api/auth/sign-in/email', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ email: 'a@b.c', password: 'secret123' }),
	});
	const server: PeerAddressSource = { requestIP: () => ({ address: '203.0.113.7' }) };
	const forwarded = forwardTrustedIp(request, server);

	expect(forwarded.method).toBe('POST');
	const body = (await forwarded.json()) as { email: string };
	expect(body.email).toBe('a@b.c');
});
