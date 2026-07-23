/**
 * The security-headers plugin: sets a strict, locked-secure baseline on every response — a default
 * `Content-Security-Policy` of `default-src 'self'` (plus the user's additive directives), HSTS in
 * production, and the usual hardening headers. Designed so the later self-hosted Scalar docs need only
 * a route-scoped CSP relaxation, never a global one.
 */

import { Elysia } from 'elysia';

import type { ResolvedHeadersOptions } from '../options/index.ts';

/**
 * Builds the security-headers plugin, stamping the resolved headers onto **every** response.
 *
 * Uses `onRequest` (not `onAfterHandle`) deliberately: `onAfterHandle` runs only on the success path,
 * so a 404, a thrown error, or a validation failure would ship with no headers — exactly the responses
 * attackers probe. Setting `set.headers` at request start applies to whatever response is produced.
 *
 * @param options - The resolved header configuration (CSP directives + HSTS flag).
 * @returns An Elysia plugin that stamps the security headers onto all responses.
 */
export function createSecurityHeaders(options: ResolvedHeadersOptions) {
	const headers = buildHeaders(options);

	return new Elysia({ name: 'glaze.security-headers' }).onRequest(({ set }) => {
		for (const [name, value] of Object.entries(headers)) {
			set.headers[name] = value;
		}
	});
}

/**
 * Builds the concrete header map from the resolved options.
 *
 * @param options - The resolved header configuration.
 * @returns Header name → value pairs to set on every response.
 */
function buildHeaders(options: ResolvedHeadersOptions): Record<string, string> {
	const headers: Record<string, string> = {
		'content-security-policy': buildCsp(options.csp),
		'x-content-type-options': 'nosniff',
		'referrer-policy': 'no-referrer',
		'x-frame-options': 'DENY',
	};

	if (options.hsts) {
		headers['strict-transport-security'] = 'max-age=63072000; includeSubDomains';
	}

	return headers;
}

/**
 * Serializes CSP directives into a header value.
 *
 * @param csp - Directive → value pairs (e.g. `{ 'default-src': "'self'" }`).
 * @returns The `Content-Security-Policy` header value (e.g. `default-src 'self'; …`).
 */
function buildCsp(csp: Readonly<Record<string, string>>): string {
	return Object.entries(csp)
		.map(([directive, value]) => `${directive} ${value}`)
		.join('; ');
}
