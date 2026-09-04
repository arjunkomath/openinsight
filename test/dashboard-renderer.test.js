import {expect, test} from 'bun:test';
import {renderDashboardGrid} from '../source/web/client/dashboard.js';

test('renderDashboardGrid renders escaped widget titles and subtitles', () => {
	const html = renderDashboardGrid(
		{
			widgets: [
				{
					type: 'table',
					title: 'Revenue <daily>',
					subtitle: 'Gross & net "sales"',
					width: 'full',
				},
			],
		},
		null,
		false,
	);

	expect(html).toContain('<h3>Revenue &lt;daily&gt;</h3>');
	expect(html).toContain(
		'<p class="widget-subtitle">Gross &amp; net &quot;sales&quot;</p>',
	);
	expect(html).not.toContain('Revenue <daily>');
});

test('renderDashboardGrid supports saved widgets without subtitles', () => {
	const html = renderDashboardGrid(
		{
			widgets: [
				{
					type: 'table',
					title: 'Legacy widget',
					width: 'half',
				},
			],
		},
		null,
		false,
	);

	expect(html).toContain('<h3>Legacy widget</h3>');
	expect(html).not.toContain('widget-subtitle');
});

test('renderDashboardGrid creates Chart.js canvases for chart widgets', () => {
	const html = renderDashboardGrid(
		{
			widgets: [
				{
					type: 'line',
					title: 'Revenue <trend>',
					subtitle: 'Gross & net revenue',
					width: 'full',
					x: 'month',
					y: ['revenue'],
				},
			],
		},
		[{error: null, data: [{month: 'Jan', revenue: 42}]}],
		false,
	);

	expect(html).toContain('canvas data-dashboard-chart="0"');
	expect(html).toContain(
		'aria-label="Revenue &lt;trend&gt;. Gross &amp; net revenue"',
	);
	expect(html).not.toContain('<svg');
});

test('renderDashboardGrid rejects non-numeric Chart.js datasets', () => {
	const html = renderDashboardGrid(
		{
			widgets: [
				{
					type: 'bar',
					title: 'Revenue',
					subtitle: 'Revenue grouped by month',
					width: 'half',
					x: 'month',
					y: ['revenue'],
				},
			],
		},
		[{error: null, data: [{month: 'Jan', revenue: 'not a number'}]}],
		false,
	);

	expect(html).toContain('Chart measure columns must contain numeric values');
	expect(html).not.toContain('<canvas');
});
