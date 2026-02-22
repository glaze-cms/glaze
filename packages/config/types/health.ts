/**
 * Resolved health check configuration after defaults are applied.
 * All fields are required.
 */
export interface ResolvedHealthCheckConfig {
	/**
	 * Whether health check is enabled.
	 * @default true
	 */
	enabled: boolean;

	/**
	 * Path for health check endpoint.
	 * @default '/_health'
	 */
	path: string;
}

/**
 * User-facing health check configuration.
 * All fields are optional.
 */
export interface HealthCheckConfig {
	enabled?: boolean;
	path?: string;
}
