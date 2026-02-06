export const DEFAULT_SERVER_PORT = 4000;
export const DEFAULT_API_PREFIX = '/api';
export const DEFAULT_ADMIN_PREFIX = '/admin';
export const DEFAULT_HEALTH_CHECK_PATH = '/_health';

/* CORS Defaults */
export const DEFAULT_CORS_METHODS = [
	'GET',
	'POST',
	'PUT',
	'DELETE',
	'OPTIONS',
] as const;

export const DEFAULT_CORS_ALLOWED_HEADERS = [
	'Content-Type',
	'Authorization',
] as const;
