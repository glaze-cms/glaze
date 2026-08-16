import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

import { getAuthClient } from './auth.ts';

/**
 * Returns a handler that ends the session and returns to the sign-in screen.
 *
 * The query cache is cleared on the way out so the next account never sees the previous one's data, and
 * navigation happens even if the sign-out request fails — the local session is unusable either way.
 *
 * @returns The sign-out handler.
 */
export function useSignOut(): () => Promise<void> {
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	return useCallback(async () => {
		try {
			await getAuthClient().signOut();
		} finally {
			queryClient.clear();
			await navigate({ to: '/login', search: {} });
		}
	}, [navigate, queryClient]);
}
