#!/usr/bin/env bun
/* eslint-disable no-console */

import { readdir } from 'fs/promises';
import { join } from 'path';

const PACKAGES_DIR = './packages';
const validBumps = ['patch', 'minor', 'major'] as const;
type BumpType = (typeof validBumps)[number];

interface PackageJson {
	name: string;
	version: string;
	private?: boolean;
}

function bumpVersion(
	currentVersion: string,
	bumpType: (typeof validBumps)[number],
): string {
	const parts = currentVersion.split('.').map(Number);
	const [major = 0, minor = 0, patch = 0] = parts;

	switch (bumpType) {
		case 'major':
			return `${String(major + 1)}.0.0`;
		case 'minor':
			return `${String(major)}.${String(minor + 1)}.0`;
		case 'patch':
			return `${String(major)}.${String(minor)}.${String(patch + 1)}`;
		default:
			throw new Error('Invalid bump type');
	}
}

/**
 * Bump version for all workspace packages
 * @example bun run bump [patch|minor|major]
 */
async function main() {
	const bumpType = process.argv[2] ?? 'patch';

	if (!validBumps.includes(bumpType as BumpType)) {
		console.error(`❌ Invalid bump type: ${bumpType}`);

		console.error(`   Valid options: ${validBumps.join(', ')}`);
		process.exit(1);
	}

	console.log(`📦 Bumping all packages (${bumpType})...\n`);

	const packages = await readdir(PACKAGES_DIR, { withFileTypes: true });
	let hasErrors = false;

	for (const pkg of packages) {
		if (!pkg.isDirectory()) continue;

		const pkgJsonPath = join(PACKAGES_DIR, pkg.name, 'package.json');

		try {
			const pkgJson = (await Bun.file(pkgJsonPath).json()) as PackageJson;

			// Skip private packages
			if (pkgJson.private) {
				console.log(`⏭️  Skipping ${pkgJson.name} (private)`);
				continue;
			}

			const oldVersion = pkgJson.version;
			const newVersion = bumpVersion(oldVersion, bumpType as BumpType);

			pkgJson.version = newVersion;

			await Bun.write(pkgJsonPath, JSON.stringify(pkgJson, null, '\t') + '\n');

			console.log(`✅ ${pkgJson.name}: ${oldVersion} → ${newVersion}`);
		} catch (error) {
			hasErrors = true;

			console.error(`❌ Failed to bump ${pkg.name}:`, error);
		}
	}

	console.log('\n✨ Done!');

	if (hasErrors) {
		process.exit(1);
	}
}

main().catch((error: unknown) => {
	if (error instanceof Error) {
		console.error(error.message);
	} else {
		console.error(error);
	}
	process.exitCode = 1;
});
