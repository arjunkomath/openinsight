import {test, expect} from 'bun:test';
import {
	createConnection,
	prepareDriverQuery,
	testConnection,
	validateConnectionString,
} from '../source/utils/DbConnector.js';

test('validateConnectionString accepts supported prefixes', () => {
	expect(validateConnectionString('sqlite://./data.db')).toEqual({
		isValid: true,
		protocol: 'sqlite',
	});
	expect(validateConnectionString('file://./data.db')).toEqual({
		isValid: true,
		protocol: 'sqlite',
	});
	expect(
		validateConnectionString('postgres://user:pass@localhost:5432/db'),
	).toEqual({isValid: true, protocol: 'postgres'});
	expect(
		validateConnectionString('postgresql://user:pass@localhost:5432/db'),
	).toEqual({isValid: true, protocol: 'postgres'});
	expect(
		validateConnectionString('mysql://user:pass@localhost:3306/db'),
	).toEqual({isValid: true, protocol: 'mysql'});
	expect(
		validateConnectionString('mysql2://user:pass@localhost:3306/db'),
	).toEqual({isValid: true, protocol: 'mysql'});
});

test('validateConnectionString rejects invalid formats', () => {
	expect(validateConnectionString('')).toEqual({
		isValid: false,
		error: 'Connection string is required',
	});
	expect(validateConnectionString('mysql://bad')).toEqual({
		isValid: false,
		error: 'Invalid MySQL connection string format',
	});
	expect(validateConnectionString('postgres://bad')).toEqual({
		isValid: false,
		error: 'Invalid PostgreSQL connection string format',
	});
	expect(validateConnectionString('redis://localhost')).toEqual({
		isValid: false,
		error: 'Unsupported database type. Use postgres://, mysql://, or sqlite://',
	});
});

test('testConnection returns failure instead of rejecting on connect errors', async () => {
	const result = await testConnection('mysql://user:%ZZ@localhost/db');
	expect(result.success).toBe(false);
	expect(typeof result.error).toBe('string');
	expect(result.error.length).toBeGreaterThan(0);
});

test('prepareDriverQuery translates and reorders MySQL parameters', () => {
	expect(
		prepareDriverQuery(
			'SELECT * FROM events WHERE created_at < $2 AND created_at >= $1 OR updated_at >= $1',
			['start', 'end'],
			'mysql',
		),
	).toEqual({
		sql: 'SELECT * FROM events WHERE created_at < ? AND created_at >= ? OR updated_at >= ?',
		parameters: ['end', 'start', 'start'],
	});
});

test('prepareDriverQuery leaves PostgreSQL parameters unchanged', () => {
	const query = 'SELECT * FROM events WHERE created_at >= $1';
	expect(prepareDriverQuery(query, ['start'], 'postgres')).toEqual({
		sql: query,
		parameters: ['start'],
	});
});

test('SQLite binds numbered parameters regardless of order and repetition', async () => {
	const conn = await createConnection('sqlite://:memory:');
	try {
		const rows = await conn.query(
			`SELECT $2 AS end, $1 AS start, $2 AS repeated, '$1' AS literal, 'it''s $2' AS escaped, $1 AS "$2" /* $3 */ -- $4
			WHERE '2026-02-01' < $2 AND '2026-02-01' >= $1`,
			{parameters: ['2026-01-01', '2026-03-01']},
		);
		expect(rows).toEqual([
			{
				end: '2026-03-01',
				start: '2026-01-01',
				repeated: '2026-03-01',
				literal: '$1',
				escaped: "it's $2",
				$2: '2026-01-01',
			},
		]);
	} finally {
		await conn.close();
	}
});

test('sqlite connection can query via Bun.SQL', async () => {
	const path = `/tmp/openinsight-test-${crypto.randomUUID()}.db`;
	const connectionString = `sqlite://${path}`;

	const setup = await createConnection(connectionString);
	await setup.query('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)');
	await setup.query(`INSERT INTO users (name) VALUES ('ada')`);
	await setup.close();

	const conn = await createConnection(connectionString);
	const rows = await conn.query('SELECT name FROM users');
	expect(rows).toEqual([{name: 'ada'}]);
	await conn.close();

	const result = await testConnection(connectionString);
	expect(result.success).toBe(true);
});
