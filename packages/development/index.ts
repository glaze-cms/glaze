import { glaze } from '@glaze/core';

glaze({
	config: {
		schema: [],
		healthCheck: {
			path: '/health',
		},
	},
});
