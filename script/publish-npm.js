import {$} from 'bun';
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {
	chmod,
	copyFile,
	mkdir,
	readFile,
	rm,
	writeFile,
} from 'node:fs/promises';
import path from 'node:path';

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const distDir = path.resolve(process.env.DIST_DIR ?? 'dist');
const stageDir = path.resolve(
	process.env.STAGE_DIR ?? path.join(distDir, 'npm'),
);
const tag = process.env.GITHUB_REF_NAME;

// Adding a target here is not enough to publish it: npm cannot attach a trusted
// publisher to a package that does not exist, so a new platform package has to
// be published by hand once before CI can take it over.
const targets = {
	'darwin-arm64': {os: 'darwin', cpu: 'arm64'},
	'linux-arm64': {os: 'linux', cpu: 'arm64'},
	'linux-x64': {os: 'linux', cpu: 'x64'},
};

if (!tag) {
	throw new Error('GITHUB_REF_NAME is required, for example v0.9.0');
}

if (!tag.startsWith('v')) {
	throw new Error(
		`GITHUB_REF_NAME must be a version tag starting with "v": ${tag}`,
	);
}

const version = tag.slice(1);
const source = JSON.parse(await readFile('package.json', 'utf8'));

if (source.version !== version) {
	console.warn(
		`package.json is at ${source.version} but the tag is ${tag}; publishing ${version}.`,
	);
}

function platformPackageName(target) {
	return `openinsight-${target}`;
}

async function writeManifest(dir, manifest) {
	await writeFile(
		path.join(dir, 'package.json'),
		`${JSON.stringify(manifest, null, '\t')}\n`,
	);
}

async function isPublished(name) {
	const result = await $`npm view ${`${name}@${version}`} version`
		.quiet()
		.nothrow();

	return result.exitCode === 0 && result.stdout.toString().trim() !== '';
}

async function stagePlatformPackage(target) {
	const archive = path.join(distDir, `openinsight-${target}.tar.gz`);
	if (!existsSync(archive)) {
		throw new Error(`Missing release archive: ${archive}`);
	}

	const name = platformPackageName(target);
	const dir = path.join(stageDir, name);
	const binDir = path.join(dir, 'bin');

	await rm(dir, {recursive: true, force: true});
	await mkdir(binDir, {recursive: true});
	await $`tar -xzf ${archive} -C ${binDir}`;
	await chmod(path.join(binDir, 'openinsight'), 0o755);

	await writeManifest(dir, {
		name,
		version,
		description: `${source.description} (${target} binary)`,
		license: source.license,
		author: source.author,
		repository: source.repository,
		homepage: source.homepage,
		bugs: source.bugs,
		os: [targets[target].os],
		cpu: [targets[target].cpu],
		files: ['bin/openinsight'],
		preferUnplugged: true,
	});

	return {name, dir};
}

async function stageMainPackage() {
	const dir = path.join(stageDir, source.name);

	await rm(dir, {recursive: true, force: true});
	await mkdir(path.join(dir, 'bin'), {recursive: true});
	await copyFile('bin/openinsight.js', path.join(dir, 'bin/openinsight.js'));
	await copyFile('readme.md', path.join(dir, 'readme.md'));
	await copyFile('LICENSE', path.join(dir, 'LICENSE'));

	const {scripts, dependencies, devDependencies, ...manifest} = source;

	const optionalDependencies = Object.fromEntries(
		Object.keys(targets).map(target => [platformPackageName(target), version]),
	);

	await writeManifest(dir, {...manifest, version, optionalDependencies});

	return {name: source.name, dir};
}

async function publish({name, dir}) {
	if (await isPublished(name)) {
		console.log(`${name}@${version} is already published, skipping.`);
		return;
	}

	const flags = ['--access', 'public'];
	if (process.env.GITHUB_ACTIONS) {
		flags.push('--provenance');
	}
	if (dryRun) {
		flags.push('--dry-run');
	}

	// Inherited stdio, not Bun's $, so npm can prompt for a 2FA one-time
	// password when publishing from a terminal.
	const result = spawnSync('npm', ['publish', ...flags], {
		cwd: dir,
		stdio: 'inherit',
	});

	if (result.status !== 0) {
		throw new Error(`npm publish failed for ${name}`);
	}
}

const platformPackages = [];
for (const target of Object.keys(targets)) {
	platformPackages.push(await stagePlatformPackage(target));
}

const mainPackage = await stageMainPackage();

// Platform packages go first so the main package never resolves to
// optional dependencies that are not on the registry yet.
for (const platformPackage of platformPackages) {
	await publish(platformPackage);
}

await publish(mainPackage);
