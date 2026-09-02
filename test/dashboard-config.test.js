import {expect, test} from 'bun:test';
import {parseDashboardConfig} from '../source/utils/DashboardConfig.js';

const dashboard = {
	title: 'Revenue overview',
	description: 'Revenue and orders over time',
	defaultRange: {type: 'relative', days: 30},
	widgets: [
		{
			type: 'line',
			title: 'Daily revenue',
			width: 'full',
			sql: 'SELECT day, revenue FROM sales WHERE created_at >= $1 AND created_at < $2 LIMIT 1000',
			x: 'day',
			y: ['revenue'],
		},
	],
};

test('parseDashboardConfig accepts agent-authored time-aware dashboards', () => {
	const result = parseDashboardConfig({...dashboard, id: 'saved-metadata'});
	expect(result.error).toBeNull();
	expect(result.dashboard).toEqual(dashboard);
});

test('parseDashboardConfig rejects mutation queries', () => {
	const result = parseDashboardConfig({
		...dashboard,
		widgets: [
			{
				type: 'table',
				title: 'Unsafe',
				width: 'half',
				sql: 'DELETE FROM sales WHERE created_at >= $1 AND created_at < $2',
			},
		],
	});

	expect(result.error).toContain('Only SELECT and WITH queries are allowed');
});

test('parseDashboardConfig requires both time-range parameters', () => {
	const result = parseDashboardConfig({
		...dashboard,
		widgets: [
			{
				type: 'table',
				title: 'Missing end',
				width: 'half',
				sql: 'SELECT * FROM sales WHERE created_at >= $1 LIMIT 1000',
			},
		],
	});

	expect(result.error).toContain('$1 for the start and $2 for the end');
});
