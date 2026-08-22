#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import {chmodSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

const supportedTargets = ['darwin-arm64', 'linux-arm64', 'linux-x64'];
const target = `${process.platform}-${process.arch}`;
const packageName = `openinsight-${target}`;

function fail(message) {
	const alternatives = [
		'',
		'Alternatives:',
		'  brew install arjunkomath/tap/openinsight',
		'  https://github.com/arjunkomath/openinsight/releases',
		'  git clone the repo and run it with Bun (>=1.4): bun source/cli.js',
	];

	console.error([message, ...alternatives].join('\n'));
	process.exit(1);
}

function resolveBinary() {
	if (!supportedTargets.includes(target)) {
		fail(
			`openinsight does not ship a prebuilt binary for ${target}.\n` +
				`Supported platforms: ${supportedTargets.join(', ')}.`,
		);
	}

	try {
		const manifest = require.resolve(`${packageName}/package.json`);
		return path.join(path.dirname(manifest), 'bin', 'openinsight');
	} catch {
		fail(
			`Could not find ${packageName}, which holds the binary for this platform.\n` +
				'It is an optional dependency, so this usually means the install ran with\n' +
				'--no-optional or --omit=optional. Reinstall with optional dependencies enabled.',
		);
	}
}

function run(binary) {
	return spawnSync(binary, process.argv.slice(2), {stdio: 'inherit'});
}

const binary = resolveBinary();

let result = run(binary);

if (result.error?.code === 'EACCES') {
	chmodSync(binary, 0o755);
	result = run(binary);
}

if (result.error) {
	fail(`Failed to run ${binary}: ${result.error.message}`);
}

if (result.signal) {
	process.kill(process.pid, result.signal);
}

process.exit(result.status ?? 1);
