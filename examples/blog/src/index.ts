import { glaze } from '@glaze/core';

import * as schema from './schema';

const blog = glaze({
	database: process.env.DATABASE_URL,
	schema,
});

blog.start(4000);
