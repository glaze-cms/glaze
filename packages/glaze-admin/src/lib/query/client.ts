import { QueryClient } from '@tanstack/react-query';

import { ApiError } from '@/lib/api';

/**
 * Builds the app-wide query client.
 *
 * 4xx responses are never retried: the API answers `401` for an expired session and `404` for a missing
 * record, and retrying either only delays the redirect or the empty state.
 *
 * @returns A configured query client.
 */
export function createQueryClient(): QueryClient {
	return new QueryClient({
		defaultOptions: {
			queries: {
				retry: (failureCount: number, error: Error) => {
					if (error instanceof ApiError && error.status < 500) return false;
					return failureCount < 2;
				},
				staleTime: 30_000,
				refetchOnWindowFocus: false,
			},
		},
	});
}
