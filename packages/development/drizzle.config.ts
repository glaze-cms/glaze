import { defineConfig } from 'drizzle-kit';

export default defineConfig({
	schema: './schema/index.ts',
	dialect: 'postgresql',
	out: './drizzle',
	schemaFilter: ['public'],
	entities: {
		roles: {
			provider: 'supabase',
		},
	},
	dbCredentials: {
		url: process.env.DATABASE_URL as string,
	},
});
