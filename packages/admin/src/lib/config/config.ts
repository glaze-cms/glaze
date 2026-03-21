type GlazeConfig = {
	apiPrefix: string;
	adminPrefix: string;
};

let cached: GlazeConfig | null = null;

export async function loadConfig(): Promise<GlazeConfig> {
	if (cached) return cached;
	const res = await fetch(`${import.meta.env.BASE_URL}config`);
	cached = (await res.json()) as GlazeConfig;
	return cached;
}

export function getConfig(): GlazeConfig {
	return cached ?? { apiPrefix: '/api', adminPrefix: '/admin' };
}
