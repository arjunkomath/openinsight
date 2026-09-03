import {expect, test} from 'bun:test';
import {createConnection} from '../source/utils/DbConnector.js';
import {runDashboard} from '../source/utils/DashboardProcessor.js';

const unavailableAI = {
	provider: 'claude',
	available: false,
	unavailableMessage: 'AI unavailable in test',
};

test('runDashboard binds its time range and keeps widget failures isolated', async () => {
	const path = `/tmp/openinsight-dashboard-${crypto.randomUUID()}.db`;
	const connectionString = `sqlite://${path}`;
	const setup = await createConnection(connectionString);
	await setup.query('CREATE TABLE events (name TEXT, created_at TEXT)');
	await setup.query(
		"INSERT INTO events VALUES ('old', '2026-01-01T00:00:00.000Z'), ('current', '2026-02-01T00:00:00.000Z')",
	);
	await setup.close();

	const result = await runDashboard(
		{
			title: 'Events',
			description: '',
			defaultRange: {type: 'relative', days: 30},
			widgets: [
				{
					type: 'table',
					title: 'Recent events',
					subtitle: 'Events in the selected period',
					width: 'half',
					sql: 'SELECT name FROM events WHERE created_at >= $1 AND created_at < $2 ORDER BY created_at LIMIT 1000',
				},
				{
					type: 'table',
					title: 'Broken widget',
					subtitle: 'A widget with an invalid result column',
					width: 'half',
					sql: 'SELECT missing FROM events WHERE created_at >= $1 AND created_at < $2 LIMIT 1000',
				},
			],
		},
		'2026-01-15T00:00:00.000Z',
		'2026-03-01T00:00:00.000Z',
		connectionString,
		{},
		unavailableAI,
	);

	expect(result.error).toBeNull();
	expect(result.results[0]).toMatchObject({
		error: null,
		data: [{name: 'current'}],
	});
	expect(result.results[1].error).toContain('Automatic repair unavailable');
});

test('runDashboard rejects an inverted time range before querying', async () => {
	const result = await runDashboard(
		{
			title: 'Events',
			description: '',
			defaultRange: {type: 'relative', days: 30},
			widgets: [
				{
					type: 'table',
					title: 'Events',
					subtitle: 'Events in the selected period',
					width: 'full',
					sql: 'SELECT * FROM events WHERE created_at >= $1 AND created_at < $2 LIMIT 1000',
				},
			],
		},
		'2026-03-01T00:00:00.000Z',
		'2026-01-15T00:00:00.000Z',
		'sqlite://./missing.db',
		{},
		unavailableAI,
	);

	expect(result).toEqual({
		error: 'The start time must be before the end time',
		results: null,
	});
});
