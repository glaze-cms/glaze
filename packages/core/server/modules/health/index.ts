import type { GlazeEnv } from '../../validators/env';

export function createHealthCheckResponse(env: GlazeEnv) {
	return {
		status: 'ok' as const,
		service: 'glaze',
		environment: env.NODE_ENV,
		uptime: process.uptime(),
		timestamp: new Date().toISOString(),
	};
}
