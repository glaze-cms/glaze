/**
 * The server manifest served at the Glaze origin root. It is the admin's only source for where the API
 * and admin subtrees live, because both prefixes are configurable server-side (`prefixes.api` /
 * `prefixes.admin`) and the bundle is built long before those values are known.
 */
export interface GlazeManifest {
	readonly name: string;
	readonly apiPrefix: string;
	readonly adminPrefix: string;
	readonly healthPath: string | null;
}

/** Used until {@link loadManifest} resolves, and if the manifest cannot be read. Matches the server defaults. */
const FALLBACK_MANIFEST: GlazeManifest = {
	name: 'glaze',
	apiPrefix: '/api',
	adminPrefix: '/admin',
	healthPath: '/_health',
};

let cached: GlazeManifest | null = null;

/**
 * Reads a non-empty string, or falls back.
 *
 * @param value - The candidate value from the payload.
 * @param fallback - Used when the candidate is absent or not a non-empty string.
 * @returns The resolved string.
 */
function readString(value: unknown, fallback: string): string {
	return typeof value === 'string' && value.length > 0 ? value : fallback;
}

/**
 * Narrows an unknown JSON payload to a manifest, filling anything missing from the fallback.
 *
 * @param payload - The parsed response body.
 * @returns A complete manifest.
 */
function toManifest(payload: unknown): GlazeManifest {
	if (typeof payload !== 'object' || payload === null) return FALLBACK_MANIFEST;

	const record = payload as Partial<Record<keyof GlazeManifest, unknown>>;

	return {
		name: readString(record.name, FALLBACK_MANIFEST.name),
		apiPrefix: readString(record.apiPrefix, FALLBACK_MANIFEST.apiPrefix),
		adminPrefix: readString(record.adminPrefix, FALLBACK_MANIFEST.adminPrefix),
		healthPath: typeof record.healthPath === 'string' ? record.healthPath : null,
	};
}

/**
 * Returns the manifest loaded at boot, or the defaults when {@link loadManifest} has not run or failed.
 * Safe to call synchronously from anywhere in the render tree.
 *
 * @returns The current manifest.
 */
export function getManifest(): GlazeManifest {
	return cached ?? FALLBACK_MANIFEST;
}

/**
 * Fetches the manifest from the Glaze origin root and caches it for {@link getManifest}.
 *
 * The admin is served same-origin by the Glaze server (in dev, through its proxy to Vite), so the manifest
 * is always at `/` of the current origin regardless of how deep the SPA has navigated.
 *
 * @returns The manifest.
 * @throws {Error} When the request fails or the server answers with a non-2xx status.
 */
export async function loadManifest(): Promise<GlazeManifest> {
	if (cached) return cached;

	const response = await fetch(new URL('/', window.location.origin), {
		headers: { accept: 'application/json' },
	});
	if (!response.ok) {
		throw new Error(`Could not read the Glaze manifest: the server answered ${response.status}.`);
	}

	cached = toManifest(await response.json());
	return cached;
}
