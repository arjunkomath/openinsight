import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'fs';
import {join} from 'path';
import {tmpdir} from 'os';
import {test, expect} from 'bun:test';
import {
	loadDashboards,
	removeDashboard,
	removeDataSource,
	saveDashboard,
	updateDashboard,
} from '../source/utils/ConfigManager.js';

const withTempConfig = callback => {
	const previousCwd = process.cwd();
	const directory = mkdtempSync(join(tmpdir(), 'openinsight-config-'));

	try {
		process.chdir(directory);
		callback(directory);
	} finally {
		process.chdir(previousCwd);
		rmSync(directory, {recursive: true, force: true});
	}
};

test('removeDataSource removes only the selected source and its saved items', () => {
	withTempConfig(directory => {
		const configDirectory = join(directory, '.openinsight');
		const configFile = join(configDirectory, 'config.json');
		mkdirSync(configDirectory, {recursive: true});
		writeFileSync(
			configFile,
			JSON.stringify(
				{
					version: '1.0.0',
					lastModified: '2026-01-01T00:00:00.000Z',
					dataSources: [
						{id: 'source-1', name: 'Production', type: 'postgres'},
						{id: 'source-2', name: 'Local', type: 'sqlite'},
					],
					presets: {
						'source-1': [{id: 'preset-1', name: 'Users'}],
						'source-2': [{id: 'preset-2', name: 'Orders'}],
					},
					dashboards: {
						'source-1': [{id: 'dashboard-1', title: 'Users'}],
						'source-2': [{id: 'dashboard-2', title: 'Orders'}],
					},
				},
				null,
				2,
			),
			'utf-8',
		);

		expect(removeDataSource('source-1')).toBe(true);

		const config = JSON.parse(readFileSync(configFile, 'utf-8'));
		expect(config.dataSources).toEqual([
			{id: 'source-2', name: 'Local', type: 'sqlite'},
		]);
		expect(config.presets).toEqual({
			'source-2': [{id: 'preset-2', name: 'Orders'}],
		});
		expect(config.dashboards).toEqual({
			'source-2': [{id: 'dashboard-2', title: 'Orders'}],
		});
		expect(config.version).toBe('1.0.0');
		expect(config.lastModified).not.toBe('2026-01-01T00:00:00.000Z');
	});
});

test('dashboard config can be saved, updated, loaded, and removed', () => {
	withTempConfig(() => {
		const definition = {
			title: 'Revenue',
			description: 'Revenue over time',
			defaultRange: {type: 'relative', days: 30},
			widgets: [
				{
					type: 'table',
					title: 'Orders',
					width: 'full',
					sql: 'SELECT * FROM orders WHERE created_at >= $1 AND created_at < $2 LIMIT 1000',
				},
			],
		};

		const created = saveDashboard('source-1', definition, 'Build revenue');
		expect(created.success).toBe(true);
		expect(loadDashboards('source-1')).toHaveLength(1);
		expect(created.dashboard.prompt).toBe('Build revenue');

		const updated = updateDashboard('source-1', created.dashboard.id, {
			...definition,
			title: 'Revenue and orders',
		});
		expect(updated.success).toBe(true);
		expect(updated.dashboard.createdAt).toBe(created.dashboard.createdAt);
		expect(updated.dashboard.prompt).toBe('Build revenue');
		expect(loadDashboards('source-1')[0].title).toBe('Revenue and orders');

		expect(removeDashboard('source-1', created.dashboard.id)).toBe(true);
		expect(loadDashboards('source-1')).toEqual([]);
	});
});

test('removeDataSource returns false when the source does not exist', () => {
	withTempConfig(directory => {
		const configDirectory = join(directory, '.openinsight');
		const configFile = join(configDirectory, 'config.json');
		mkdirSync(configDirectory, {recursive: true});
		writeFileSync(
			configFile,
			JSON.stringify(
				{
					version: '1.0.0',
					dataSources: [{id: 'source-1', name: 'Production'}],
					presets: {'source-1': [{id: 'preset-1'}]},
				},
				null,
				2,
			),
			'utf-8',
		);

		expect(removeDataSource('missing-source')).toBe(false);

		const config = JSON.parse(readFileSync(configFile, 'utf-8'));
		expect(config.dataSources).toEqual([{id: 'source-1', name: 'Production'}]);
		expect(config.presets).toEqual({'source-1': [{id: 'preset-1'}]});
	});
});
