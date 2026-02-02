import { glaze } from '@glaze/core';

glaze({
	config: {
		adminPrefix: '/administrador',
		healthCheck: {
			enabled: true,
			path: '/status',
		},
	},
});
