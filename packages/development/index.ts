import { glaze } from '@glaze/core';

import * as schema from './schema/index.ts';

await glaze({
	config: {
		schema,
	},
});
