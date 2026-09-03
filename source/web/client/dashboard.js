const CHART_COLORS = [
	'var(--chart-1)',
	'var(--chart-2)',
	'var(--chart-3)',
	'var(--chart-4)',
];

const escapeHtml = value =>
	String(value ?? '')
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#039;');

const toNumber = value => {
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	if (typeof value === 'bigint') return Number(value);
	if (typeof value !== 'string' || !value.trim()) return null;
	const number = Number(value);
	return Number.isFinite(number) ? number : null;
};

const formatNumber = value =>
	new Intl.NumberFormat(undefined, {maximumFractionDigits: 2}).format(value);

const formatCell = value => {
	if (value === null || value === undefined)
		return '<span class="null">NULL</span>';
	if (typeof value === 'object') return escapeHtml(JSON.stringify(value));
	if (typeof value === 'boolean') return `<span class="bool">${value}</span>`;
	return escapeHtml(value);
};

const shortLabel = value => {
	const label = String(value ?? '');
	return label.length > 16 ? `${label.slice(0, 15)}…` : label;
};

const widgetError = message =>
	`<div class="widget-state danger-text">${escapeHtml(message)}</div>`;

const renderTable = rows => {
	if (rows.length === 0) return '<div class="widget-state">No rows</div>';
	const columns = Object.keys(rows[0]);
	const visibleRows = rows.slice(0, 100);
	return `
		<div class="table-wrap dashboard-table-wrap">
			<table>
				<thead><tr>${columns.map(column => `<th>${escapeHtml(column)}</th>`).join('')}</tr></thead>
				<tbody>${visibleRows
					.map(
						row =>
							`<tr>${columns.map(column => `<td>${formatCell(row[column])}</td>`).join('')}</tr>`,
					)
					.join('')}</tbody>
			</table>
		</div>
		${rows.length > visibleRows.length ? `<div class="chart-note">Showing first ${visibleRows.length} of ${rows.length} rows</div>` : ''}
	`;
};

const renderCartesian = (widget, rows) => {
	if (rows.length === 0) return '<div class="widget-state">No data</div>';
	const missing = [widget.x, ...widget.y].filter(
		column => !Object.hasOwn(rows[0], column),
	);
	if (missing.length > 0) {
		return widgetError(
			`Missing result ${missing.length === 1 ? 'column' : 'columns'}: ${missing.join(', ')}`,
		);
	}

	const visibleRows = rows.slice(0, widget.type === 'bar' ? 24 : 80);
	const series = widget.y.map(column => ({
		column,
		values: visibleRows.map(row => toNumber(row[column])),
	}));
	if (series.some(item => item.values.some(value => value === null))) {
		return widgetError('Chart measure columns must contain numeric values');
	}

	const width = 640;
	const height = 280;
	const plot = {left: 58, right: 18, top: 18, bottom: 52};
	const plotWidth = width - plot.left - plot.right;
	const plotHeight = height - plot.top - plot.bottom;
	const values = series.flatMap(item => item.values);
	let min =
		widget.type === 'bar' ? Math.min(0, ...values) : Math.min(...values);
	let max =
		widget.type === 'bar' ? Math.max(0, ...values) : Math.max(...values);
	if (min === max) {
		min -= Math.abs(min * 0.1) || 1;
		max += Math.abs(max * 0.1) || 1;
	} else if (widget.type === 'line') {
		const padding = (max - min) * 0.08;
		min -= padding;
		max += padding;
	}
	const scaleY = value =>
		plot.top + plotHeight - ((value - min) / (max - min)) * plotHeight;
	const scaleX = index =>
		plot.left +
		(visibleRows.length === 1
			? plotWidth / 2
			: (index / (visibleRows.length - 1)) * plotWidth);
	const tickIndexes = Array.from(
		new Set(
			Array.from({length: Math.min(6, visibleRows.length)}, (_, index) =>
				Math.round(
					(index / Math.max(Math.min(6, visibleRows.length) - 1, 1)) *
						(visibleRows.length - 1),
				),
			),
		),
	);

	let marks;
	if (widget.type === 'line') {
		marks = series
			.map((item, seriesIndex) => {
				const points = item.values
					.map((value, index) => `${scaleX(index)},${scaleY(value)}`)
					.join(' ');
				const dots = item.values
					.map(
						(value, index) =>
							`<circle cx="${scaleX(index)}" cy="${scaleY(value)}" r="3" fill="${CHART_COLORS[seriesIndex]}"><title>${escapeHtml(visibleRows[index][widget.x])}: ${escapeHtml(item.column)} ${formatNumber(value)}</title></circle>`,
					)
					.join('');
				return `<polyline points="${points}" fill="none" stroke="${CHART_COLORS[seriesIndex]}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />${dots}`;
			})
			.join('');
	} else {
		const groupWidth = plotWidth / visibleRows.length;
		const barWidth = Math.max(
			2,
			Math.min(28, (groupWidth * 0.72) / series.length),
		);
		const zeroY = scaleY(0);
		marks = visibleRows
			.flatMap((row, rowIndex) =>
				series.map((item, seriesIndex) => {
					const value = item.values[rowIndex];
					const y = scaleY(value);
					const x =
						plot.left +
						rowIndex * groupWidth +
						(groupWidth - barWidth * series.length) / 2 +
						seriesIndex * barWidth;
					return `<rect x="${x}" y="${Math.min(y, zeroY)}" width="${barWidth}" height="${Math.max(Math.abs(zeroY - y), 1)}" fill="${CHART_COLORS[seriesIndex]}" rx="1"><title>${escapeHtml(row[widget.x])}: ${escapeHtml(item.column)} ${formatNumber(value)}</title></rect>`;
				}),
			)
			.join('');
	}

	return `
		<div class="chart-wrap">
			<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(widget.title)}">
				<line class="chart-axis" x1="${plot.left}" y1="${plot.top}" x2="${plot.left}" y2="${plot.top + plotHeight}" />
				<line class="chart-axis" x1="${plot.left}" y1="${plot.top + plotHeight}" x2="${width - plot.right}" y2="${plot.top + plotHeight}" />
				<text class="chart-label" x="${plot.left - 8}" y="${plot.top + 4}" text-anchor="end">${escapeHtml(formatNumber(max))}</text>
				<text class="chart-label" x="${plot.left - 8}" y="${plot.top + plotHeight}" text-anchor="end">${escapeHtml(formatNumber(min))}</text>
				${marks}
				${tickIndexes
					.map(
						index =>
							`<text class="chart-label" x="${scaleX(index)}" y="${height - 25}" text-anchor="middle">${escapeHtml(shortLabel(visibleRows[index][widget.x]))}</text>`,
					)
					.join('')}
			</svg>
		</div>
		<div class="chart-legend">${series
			.map(
				(item, index) =>
					`<span><i style="background:${CHART_COLORS[index]}"></i>${escapeHtml(item.column)}</span>`,
			)
			.join('')}</div>
		${rows.length > visibleRows.length ? `<div class="chart-note">Showing first ${visibleRows.length} of ${rows.length} points</div>` : ''}
	`;
};

const polarPoint = (centerX, centerY, radius, angle) => ({
	x: centerX + radius * Math.cos(angle),
	y: centerY + radius * Math.sin(angle),
});

const renderPie = (widget, rows) => {
	if (rows.length === 0) return '<div class="widget-state">No data</div>';
	const missing = [widget.label, widget.value].filter(
		column => !Object.hasOwn(rows[0], column),
	);
	if (missing.length > 0)
		return widgetError(`Missing result columns: ${missing.join(', ')}`);

	const values = rows
		.map(row => ({
			label: row[widget.label],
			value: toNumber(row[widget.value]),
		}))
		.filter(item => item.value !== null && item.value > 0)
		.slice(0, 8);
	if (values.length === 0)
		return widgetError('Pie chart values must be positive numbers');
	const total = values.reduce((sum, item) => sum + item.value, 0);
	let angle = -Math.PI / 2;
	const center = {x: 155, y: 130, radius: 92};
	const slices = values
		.map((item, index) => {
			const nextAngle = angle + (item.value / total) * Math.PI * 2;
			if (values.length === 1) {
				angle = nextAngle;
				return `<circle cx="${center.x}" cy="${center.y}" r="${center.radius}" fill="${CHART_COLORS[index % CHART_COLORS.length]}"><title>${escapeHtml(item.label)}: ${formatNumber(item.value)}</title></circle>`;
			}
			const start = polarPoint(center.x, center.y, center.radius, angle);
			const end = polarPoint(center.x, center.y, center.radius, nextAngle);
			const largeArc = nextAngle - angle > Math.PI ? 1 : 0;
			const path = `M ${center.x} ${center.y} L ${start.x} ${start.y} A ${center.radius} ${center.radius} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
			angle = nextAngle;
			return `<path d="${path}" fill="${CHART_COLORS[index % CHART_COLORS.length]}"><title>${escapeHtml(item.label)}: ${formatNumber(item.value)}</title></path>`;
		})
		.join('');

	return `
		<div class="pie-layout">
			<svg class="pie-chart" viewBox="0 0 310 260" role="img" aria-label="${escapeHtml(widget.title)}">${slices}</svg>
			<div class="pie-legend">${values
				.map(
					(item, index) => `
						<div><i style="background:${CHART_COLORS[index % CHART_COLORS.length]}"></i><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(formatNumber(item.value))}</strong></div>
					`,
				)
				.join('')}</div>
		</div>
		${rows.length > values.length ? `<div class="chart-note">Showing first ${values.length} categories</div>` : ''}
	`;
};

export function renderDashboardGrid(dashboard, results, busy) {
	return dashboard.widgets
		.map((widget, index) => {
			const result = results?.[index];
			let body;
			if (busy) body = '<div class="widget-state">Running…</div>';
			else if (!result)
				body = '<div class="widget-state">Run the dashboard to load data</div>';
			else if (result.error) body = widgetError(result.error);
			else if (widget.type === 'table') body = renderTable(result.data || []);
			else if (widget.type === 'pie')
				body = renderPie(widget, result.data || []);
			else body = renderCartesian(widget, result.data || []);

			return `
				<section class="dashboard-widget dashboard-widget-${widget.width}">
					<div class="widget-head">
						<div class="widget-heading">
							<h3>${escapeHtml(widget.title)}</h3>
							${widget.subtitle ? `<p class="widget-subtitle">${escapeHtml(widget.subtitle)}</p>` : ''}
						</div>
						<span class="tag tag-quiet">${escapeHtml(widget.type)}</span>
					</div>
					<div class="widget-body">${body}</div>
				</section>
			`;
		})
		.join('');
}
