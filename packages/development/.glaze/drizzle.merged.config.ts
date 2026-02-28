import { defineConfig } from 'drizzle-kit';
import userConfig from '../drizzle.config';

const userSchemas = !userConfig.schema
	? []
	: Array.isArray(userConfig.schema)
		? userConfig.schema
		: [userConfig.schema];

const userFilters = Array.isArray(userConfig.schemaFilter)
	? userConfig.schemaFilter
	: userConfig.schemaFilter
		? [userConfig.schemaFilter]
		: ['public'];

export default defineConfig({
	...userConfig,
	schema: [...userSchemas, '../core/schema/index.ts'],
	schemaFilter: [...new Set([...userFilters, 'auth', 'drizzle'])],
	dbCredentials: {
		url: process.env.DATABASE_URL!,
	},
});
