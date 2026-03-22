import { glaze } from '@glaze/cms';

import * as schema from './schema/index.ts';

glaze({
	config: {
		schema,
		sync: {
			workflow: 'solo',
			solo: {
				destructive: 'apply',
			},
		},
	},
});
