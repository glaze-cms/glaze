export interface HealthCheckConfig {
	/**
	 * Whether health check is enabled.
	 * @default true
	 */
	enabled?: boolean;

	/**
	 * Path for health check endpoint.
	 * @default '/_health'
	 */
	path?: string;
}
