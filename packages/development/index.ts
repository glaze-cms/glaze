import { glaze } from '@glaze/core';

import * as schema from './schema/index.ts';

// eslint-disable-next-line @typescript-eslint/await-thenable
await glaze({
	config: {
		schema,
	},
});
