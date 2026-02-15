#!/usr/bin/env bun

import * as p from '@clack/prompts';
import { resolve } from 'node:path';
import { styleText } from 'node:util';

// Utils
import {
	validateProjectName,
	validateDatabaseUrl,
	generateAuthSecret,
} from './validation';
import { scaffold } from './scaffold';

p.intro('Create Glaze App');

const projectName = await p.text({
	message: 'Where should your app be created?',
	placeholder: 'my-glaze-app',
	defaultValue: 'my-glaze-app',
	validate: validateProjectName,
});

if (p.isCancel(projectName)) {
	p.cancel('Cancelled.');
	process.exit(0);
}

const includeExampleSchema = await p.confirm({
	message: 'Include example schema? (posts & authors tables)',
	initialValue: true,
});

if (p.isCancel(includeExampleSchema)) {
	p.cancel('Cancelled.');
	process.exit(0);
}

p.note(
	'If you are using Supabase or Neon, you can find your\n' +
		'connection string in your project dashboard and paste it here.',
	'Pro Tip',
);

const databaseUrl = await p.text({
	message: 'Postgres connection URL',
	placeholder: 'postgresql://localhost:5432/glaze_db',
	defaultValue: 'postgresql://localhost:5432/glaze_db',
	validate: validateDatabaseUrl,
});

if (p.isCancel(databaseUrl)) {
	p.cancel('Cancelled.');
	process.exit(0);
}

const projectDir = resolve(projectName);
const s = p.spinner();

s.start('Scaffolding project files...');
const result = await scaffold(projectDir, {
	projectName: projectName as string,
	includeExampleSchema: includeExampleSchema as boolean,
	databaseUrl: databaseUrl as string,
	authSecret: generateAuthSecret(),
});

if (!result.success) {
	s.stop('Scaffolding failed');
	p.cancel(result.message);
	process.exit(1);
}
s.stop('Project files created');

s.start('Installing dependencies (this may take a moment)...');
try {
	await Bun.$`cd ${projectDir} && bun add @glaze/cms`.quiet();
	if (includeExampleSchema) {
		await Bun.$`cd ${projectDir} && bun add drizzle-orm && bun add -d drizzle-kit`.quiet();
	}
	s.stop('Dependencies installed');
} catch (error) {
	s.stop('Installation failed');
	if (error instanceof Error) {
		p.log.error(error.message);
	}
	const cmd = includeExampleSchema
		? `cd ${String(projectName)}\nbun add @glaze/cms drizzle-orm\nbun add -d drizzle-kit`
		: `cd ${String(projectName)}\nbun add @glaze/cms`;
	p.note(cmd, 'Manual installation required');
}

const nextSteps = `cd ${String(projectName)}\nbun dev`;
p.note(styleText('cyan', nextSteps), 'Next steps');

p.outro(`${styleText('bold', String(projectName))} is ready — happy glazing!`);

process.exit(0);
