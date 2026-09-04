import {test, expect} from 'bun:test';
import {createConnection} from '../source/utils/DbConnector.js';
import {createLogHandler} from '../source/utils/Logger.js';
import {executeQuery} from '../source/utils/QueryProcessor.js';

test('executeQuery rejects non-read-only SQL before connecting', async () => {
	const result = await executeQuery(
		'DELETE FROM users',
		'sqlite://./missing.db',
		{},
		null,
	);

	expect(result).toEqual({
		error: 'Only SELECT queries are allowed',
		sql: 'DELETE FROM users',
		data: null,
	});
});

test('executeQuery rejects SELECT INTO before connecting', async () => {
	const sql = 'SELECT * INTO users_copy FROM users';
	const result = await executeQuery(sql, 'sqlite://./missing.db', {}, null);

	expect(result).toEqual({
		error: 'Only SELECT queries are allowed',
		sql,
		data: null,
	});
});

test('executeQuery redacts database credentials before file logging', async () => {
	const uiLogs = [];
	const fileLogs = [];
	const result = await executeQuery(
		'DELETE FROM users',
		'postgres://user:pa/ss@localhost/database',
		{},
		{provider: 'claude', model: 'opus', available: true, verbose: true},
		createLogHandler({
			uiLog: message => uiLogs.push(message),
			fileLog: message => fileLogs.push(message),
			verbose: false,
		}),
	);

	expect(result.error).toBe('Only SELECT queries are allowed');
	expect(uiLogs).toEqual([]);
	expect(fileLogs.join('\n')).toContain(
		'postgres://<credentials>@localhost/database',
	);
	expect(fileLogs.join('\n')).not.toContain('user:pa/ss');
});

test('executeQuery does not require AI when the first attempt succeeds', async () => {
	const path = `/tmp/openinsight-query-${crypto.randomUUID()}.db`;
	const connectionString = `sqlite://${path}`;
	const setup = await createConnection(connectionString);
	await setup.query('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)');
	await setup.query(`INSERT INTO users (name) VALUES ('ada')`);
	await setup.close();

	const result = await executeQuery(
		'SELECT name FROM users',
		connectionString,
		{},
		{
			provider: 'claude',
			available: false,
			unavailableMessage: 'Claude is unavailable',
		},
	);

	expect(result).toEqual({
		error: null,
		sql: 'SELECT name FROM users',
		data: [{name: 'ada'}],
	});
});

test('executeQuery reports when automatic repair is unavailable', async () => {
	const path = `/tmp/openinsight-query-${crypto.randomUUID()}.db`;
	const connectionString = `sqlite://${path}`;
	const setup = await createConnection(connectionString);
	await setup.query('CREATE TABLE users (id INTEGER PRIMARY KEY)');
	await setup.close();

	const result = await executeQuery(
		'SELECT missing FROM users',
		connectionString,
		{},
		{
			provider: 'claude',
			available: false,
			unavailableMessage: 'Claude is unavailable',
		},
	);

	expect(result.error).toContain('Query failed:');
	expect(result.error).toContain(
		'Automatic repair unavailable: Claude is unavailable',
	);
});
