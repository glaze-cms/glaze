import { glaze } from '@glaze/core';

glaze({
	config: {
		schema: {},
		adminPrefix: '/dashboard',
		healthCheck: {
			path: '/health',
		},
	},
});
