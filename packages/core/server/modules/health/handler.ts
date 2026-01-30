import type { GlazeEnv } from '../../validators/env';

type HealthCheckResult = {
	status: 'ok';
	service: 'glaze';
	environment: GlazeEnv['NODE_ENV'];
	uptime: number;
	timestamp: string;
};

export function handleHealthCheck(env: GlazeEnv): HealthCheckResult {
	return {
		status: 'ok',
		service: 'glaze',
		environment: env.NODE_ENV,
		uptime: process.uptime(),
		timestamp: new Date().toISOString(),
	};
}
