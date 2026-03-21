type GlazeConfig = {
	apiPrefix: string;
	adminPrefix: string;
};

let cached: GlazeConfig | null = null;

export async function loadConfig(): Promise<GlazeConfig> {
	if (cached) return cached;
	// Resolve relative to the current page so the URL is correct regardless of
	// whether BASE_URL is '/' (Vite dev) or './' (production build).
	const res = await fetch(new URL('config', window.location.href));
	cached = (await res.json()) as GlazeConfig;
	return cached;
}

export function getConfig(): GlazeConfig {
	return cached ?? { apiPrefix: '/api', adminPrefix: '/admin' };
}
