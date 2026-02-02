import { glaze } from '@glaze/core';

glaze({
	config: {
		healthCheck: {
			path: '/health',
		},
	},
});
