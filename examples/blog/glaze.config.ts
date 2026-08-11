import { defineGlazeConfig } from 'glaze-cms';

// The tooling substrate the CLI and the runtime both load. SQLite keeps the example zero-setup.
export default defineGlazeConfig({
	dialect: 'sqlite',
	connection: './blog.db',
	schema: './schema.ts',
	migrations: './drizzle',
	workflow: { mode: 'solo' },
});
