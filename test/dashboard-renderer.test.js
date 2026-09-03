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
