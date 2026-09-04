import {test, expect} from 'bun:test';
import {createClaudeCliClient} from '../source/utils/ClaudeCliClient.js';
import {isAbortError} from '../source/utils/abort.js';

const jsonResponse = payload => JSON.stringify(payload);

function fakeChild(stdout, {stderr = '', exitCode = 0} = {}) {
	return {
		stdout: new Blob([stdout]).stream(),
		stderr: new Blob([stderr]).stream(),
		exited: Promise.resolve(exitCode),
		exitCode,
		kill() {},
	};
}

test('Claude client runs an isolated structured-output request via stdin', async () => {
	let invocation;
	const spawn = (command, options) => {
		invocation = {command, options};
		return fakeChild(
			jsonResponse([
				{type: 'system', subtype: 'init'},
				{
					type: 'result',
					subtype: 'success',
					is_error: false,
					structured_output: {sql: 'SELECT * FROM "users" LIMIT 1000'},
					ttft_ms: 5486,
				},
			]),
		);
	};
	const client = createClaudeCliClient('/usr/bin/claude', 'opus', null, {
		spawn,
	});

	const result = await client.generateSQL(
		'list users',
		{users: [{column: 'id', type: 'integer'}]},
		[],
	);

	expect(result).toEqual({
		sql: 'SELECT * FROM "users" LIMIT 1000',
		error: null,
	});
	expect(invocation.command[0]).toBe('/usr/bin/claude');
	expect(invocation.command).toContain('--safe-mode');
	expect(invocation.command).toContain('--json-schema');
	expect(invocation.command).toContain('--no-session-persistence');
	expect(invocation.command).toContain('mcp__*');
	const toolsIndex = invocation.command.indexOf('--tools');
	expect(invocation.command[toolsIndex + 1]).toBe('');
	expect(invocation.command.join(' ')).not.toContain('list users');
	const stdin = await invocation.options.stdin.text();
	expect(stdin).toContain('list users');
	expect(stdin).toContain('database_schema');
});

test('Claude client summarizes query results via structured output', async () => {
	let invocation;
	const client = createClaudeCliClient('/claude', 'opus', null, {
		spawn: (command, options) => {
			invocation = {command, options};
			return fakeChild(
				jsonResponse({
					type: 'result',
					subtype: 'success',
					is_error: false,
					structured_output: {summary: 'There are 12 active users.'},
				}),
			);
		},
	});

	const result = await client.summarizeResults(
		'How many users are active?',
		'SELECT 12 AS active_users',
		[{active_users: 12}],
		'Be direct',
	);

	expect(result).toEqual({summary: 'There are 12 active users.', error: null});
	expect(invocation.command.join(' ')).toContain('Summarize query results');
	const stdin = await invocation.options.stdin.text();
	expect(stdin).toContain('How many users are active?');
	expect(stdin).toContain('Be direct');
});

test('Claude client generates a complete dashboard config', async () => {
	let invocation;
	const dashboard = {
		title: 'Signups',
		description: 'Daily signups',
		defaultRange: {type: 'relative', days: 7},
		widgets: [
			{
				type: 'line',
				title: 'Daily signups',
				subtitle: 'New user accounts grouped by day',
				width: 'full',
				sql: 'SELECT day, signups FROM users WHERE created_at >= $1 AND created_at < $2 LIMIT 1000',
				x: 'day',
				y: ['signups'],
			},
		],
	};
	const client = createClaudeCliClient('/claude', 'opus', null, {
		spawn: (command, options) => {
			invocation = {command, options};
			return fakeChild(
				jsonResponse({
					type: 'result',
					subtype: 'success',
					is_error: false,
					structured_output: {
						dashboard,
						message: 'Built a signup dashboard.',
					},
				}),
			);
		},
	});

	const result = await client.generateDashboard(
		'Show signups',
		{users: [{column: 'created_at', type: 'timestamp'}]},
		'sqlite',
		null,
	);

	expect(result).toEqual({
		dashboard,
		message: 'Built a signup dashboard.',
		error: null,
	});
	expect(invocation.command.join(' ')).toContain('Build or revise a dashboard');
	const stdin = await invocation.options.stdin.text();
	expect(stdin).toContain('Show signups');
	expect(stdin).toContain('$1 as the inclusive start time');
	expect(stdin).toContain('concise subtitle');
});

test('Claude client emits full subprocess diagnostics only in verbose mode', async () => {
	const logs = [];
	const client = createClaudeCliClient(
		'/secret/path/claude',
		'opus',
		message => logs.push(message),
		{
			verbose: true,
			spawn: () =>
				fakeChild(
					jsonResponse({
						type: 'result',
						subtype: 'success',
						is_error: false,
						structured_output: {sql: 'SELECT 1 LIMIT 1000'},
					}),
				),
		},
	);

	await client.generateSQL('show one', {users: []}, []);
	const output = logs.join('\n');
	expect(output).toContain('[Verbose][Claude] Command argv:');
	expect(output).toContain('[Verbose][Claude] Prompt');
	expect(output).toContain('[Verbose][Claude] Raw stdout');
	expect(output).toContain('[Verbose][Claude] Raw stderr');
	expect(output).toContain('show one');
	expect(output).not.toContain('/secret/path/claude');
});

test('Claude client reports structured error envelopes', async () => {
	const errorClient = createClaudeCliClient('/claude', 'opus', null, {
		spawn: () =>
			fakeChild(
				jsonResponse({
					type: 'result',
					subtype: 'error',
					is_error: true,
					result: 'Authentication required',
				}),
			),
	});

	expect((await errorClient.generateSQL('q', {}, [])).error).toContain(
		'Authentication required',
	);
});

test('Claude client includes bounded stderr for a nonzero exit', async () => {
	const client = createClaudeCliClient('/claude', 'opus', null, {
		spawn: () =>
			fakeChild('', {
				exitCode: 1,
				stderr: `Authentication failed ${'x'.repeat(3000)}`,
			}),
	});

	const result = await client.generateSQL('q', {}, []);
	expect(result.error).toContain('Claude CLI exited with code 1');
	expect(result.error).toContain('Authentication failed');
	expect(result.error.length).toBeLessThan(2100);
});

test('Claude client terminates a running request when aborted', async () => {
	const controller = new AbortController();
	const signals = [];
	let resolveExit;
	const exited = new Promise(resolve => {
		resolveExit = resolve;
	});
	let stdoutController;
	let stderrController;
	const client = createClaudeCliClient('/claude', 'opus', null, {
		killGraceMs: 5,
		spawn: () => {
			const child = {
				stdout: new ReadableStream({
					start(streamController) {
						stdoutController = streamController;
					},
				}),
				stderr: new ReadableStream({
					start(streamController) {
						stderrController = streamController;
					},
				}),
				exited,
				exitCode: null,
				kill(signal) {
					signals.push(signal);
					this.exitCode = 143;
					stdoutController.close();
					stderrController.close();
					resolveExit(143);
				},
			};
			return child;
		},
	});

	const request = client.generateSQL('q', {}, [], controller.signal);
	controller.abort();

	let thrown;
	try {
		await request;
	} catch (error) {
		thrown = error;
	}

	expect(signals).toEqual(['SIGTERM']);
	expect(isAbortError(thrown)).toBe(true);
});
