#!/usr/bin/env bun
/* eslint-disable no-console */

import { readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

interface PackageJson {
	name: string;
	version: string;
	private?: boolean;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
}
interface BumpResult {
	name: string;
	oldVersion: string;
	newVersion: string;
}
type BumpType = (typeof validBumps)[number];

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const validBumps = ['patch', 'minor', 'major'] as const;

// Always resolve from repo root
const PACKAGES_DIR = join(__dirname, '..', 'packages');

function bumpVersion(
	currentVersion: string,
	bumpType: (typeof validBumps)[number],
): string {
	if (!/^\d+\.\d+\.\d+$/.test(currentVersion)) {
		throw new Error(`Invalid semver: ${currentVersion}`);
	}

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
 * Phase 1: bump versions of workspace packages
 */
async function bumpPackages(bumpType: BumpType): Promise<BumpResult[]> {
	const entries = (await readdir(PACKAGES_DIR, { withFileTypes: true }))
		.filter((e) => e.isDirectory())
		.sort((a, b) => a.name.localeCompare(b.name));

	const results: BumpResult[] = [];
	let hasErrors = false;

	for (const entry of entries) {
		const pkgJsonPath = join(PACKAGES_DIR, entry.name, 'package.json');

		try {
			const pkgJson = (await Bun.file(pkgJsonPath).json()) as PackageJson;

			if (pkgJson.private) {
				console.log(`⏭️  ${pkgJson.name} (private)`);
				continue;
			}

			const oldVersion = pkgJson.version;
			const newVersion = bumpVersion(oldVersion, bumpType);

			pkgJson.version = newVersion;

			await Bun.write(pkgJsonPath, JSON.stringify(pkgJson, null, '\t') + '\n');

			results.push({
				name: pkgJson.name,
				oldVersion,
				newVersion,
			});

			console.log(`✅ ${pkgJson.name}: ${oldVersion} → ${newVersion}`);
		} catch (error) {
			hasErrors = true;
			console.error(`❌ Failed to bump ${entry.name}:`, error);
		}
	}

	if (hasErrors) {
		throw new Error('One or more packages failed to bump');
	}

	return results;
}

/**
 * Phase 2: resolve workspace:* dependencies to actual versions
 */
async function resolveWorkspaceDeps(bumped: BumpResult[]): Promise<void> {
	const versionMap = new Map(bumped.map((p) => [p.name, p.newVersion]));

	const entries = (await readdir(PACKAGES_DIR, { withFileTypes: true }))
		.filter((e) => e.isDirectory())
		.sort((a, b) => a.name.localeCompare(b.name));

	for (const entry of entries) {
		const pkgJsonPath = join(PACKAGES_DIR, entry.name, 'package.json');

		try {
			const pkgJson = (await Bun.file(pkgJsonPath).json()) as PackageJson;

			if (pkgJson.private) continue;

			let modified = false;

			for (const depType of ['dependencies', 'devDependencies'] as const) {
				const deps = pkgJson[depType];
				if (!deps) continue;

				for (const [depName, depVersion] of Object.entries(deps)) {
					if (depVersion === 'workspace:*' && versionMap.has(depName)) {
						deps[depName] = versionMap.get(depName)!;
						modified = true;
						console.log(`  📎 ${pkgJson.name}: ${depName} → ${deps[depName]}`);
					}
				}
			}

			if (modified) {
				await Bun.write(pkgJsonPath, JSON.stringify(pkgJson, null, '\t') + '\n');
			}
		} catch (error) {
			console.error(`❌ Failed to resolve deps for ${entry.name}:`, error);
		}
	}
}

async function preRelease(bumpType: BumpType) {
	console.log(`📦 Pre-release (${bumpType})\n`);

	const bumped = await bumpPackages(bumpType);

	console.log('\n🔗 Resolving workspace dependencies...');
	await resolveWorkspaceDeps(bumped);

	console.log('\n✨ Version bump complete');
	console.log(
		bumped
			.map((p) => `• ${p.name}: ${p.oldVersion} → ${p.newVersion}`)
			.join('\n'),
	);
}

async function main() {
	const bumpType = (process.argv[2] ?? 'patch') as BumpType;

	if (!validBumps.includes(bumpType)) {
		console.error(`❌ Invalid bump type: ${bumpType}`);
		console.error(`   Valid options: ${validBumps.join(', ')}`);
		process.exit(1);
	}

	await preRelease(bumpType);
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
