import { glaze } from '@glaze/core';

await glaze({
	config: {
		schema: {},
		adminPrefix: '/dashboard',
		healthCheck: {
			path: '/health',
		},
	},
});
