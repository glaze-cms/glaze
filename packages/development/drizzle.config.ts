import { defineConfig } from 'drizzle-kit';

export default defineConfig({
	schema: './schema/index.ts',
	dialect: 'postgresql',
	out: './drizzle',
	dbCredentials: {
		url: process.env.DATABASE_URL as string,
	},
});
