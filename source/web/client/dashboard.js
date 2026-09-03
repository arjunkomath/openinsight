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

const createChartModel = (widget, rows) => {
	if (rows.length === 0) return '<div class="widget-state">No data</div>';
	if (widget.type === 'pie') {
		const missing = [widget.label, widget.value].filter(
			column => !Object.hasOwn(rows[0], column),
		);
		if (missing.length > 0) {
			return {error: `Missing result columns: ${missing.join(', ')}`};
		}

		const values = rows
			.map(row => ({
				label: row[widget.label],
				value: toNumber(row[widget.value]),
			}))
			.filter(item => item.value !== null && item.value > 0)
			.slice(0, 8);
		if (values.length === 0) {
			return {error: 'Pie chart values must be positive numbers'};
		}

		return {
			type: 'pie',
			labels: values.map(item => String(item.label ?? '')),
			datasets: [{label: widget.value, data: values.map(item => item.value)}],
			note:
				rows.length > values.length
					? `Showing first ${values.length} categories`
					: '',
		};
	}

	const missing = [widget.x, ...widget.y].filter(
		column => !Object.hasOwn(rows[0], column),
	);
	if (missing.length > 0) {
		return {
			error: `Missing result ${missing.length === 1 ? 'column' : 'columns'}: ${missing.join(', ')}`,
		};
	}

	const visibleRows = rows.slice(0, widget.type === 'bar' ? 24 : 80);
	const datasets = widget.y.map(column => ({
		label: column,
		data: visibleRows.map(row => toNumber(row[column])),
	}));
	if (datasets.some(dataset => dataset.data.some(value => value === null))) {
		return {error: 'Chart measure columns must contain numeric values'};
	}

	return {
		type: widget.type,
		labels: visibleRows.map(row => String(row[widget.x] ?? '')),
		datasets,
		note:
			rows.length > visibleRows.length
				? `Showing first ${visibleRows.length} of ${rows.length} points`
				: '',
	};
};

const renderChart = (widget, rows, index) => {
	const model = createChartModel(widget, rows);
	if (typeof model === 'string') return model;
	if (model.error) return widgetError(model.error);

	const label = [widget.title, widget.subtitle].filter(Boolean).join('. ');
	return `
		<div class="chart-wrap">
			<div class="chart-container">
				<canvas data-dashboard-chart="${index}" role="img" aria-label="${escapeHtml(label)}">${escapeHtml(label)}</canvas>
			</div>
		</div>
		${model.note ? `<div class="chart-note">${escapeHtml(model.note)}</div>` : ''}
	`;
};

let chartInstances = [];

export function destroyDashboardCharts() {
	for (const chart of chartInstances) chart.destroy();
	chartInstances = [];
}

const cssValue = (styles, property, fallback) =>
	styles.getPropertyValue(property).trim() || fallback;

export function mountDashboardCharts(container, dashboard, results) {
	destroyDashboardCharts();
	if (!container || !globalThis.Chart) return;

	const styles = getComputedStyle(document.documentElement);
	const colors = [1, 2, 3, 4].map(index =>
		cssValue(styles, `--chart-${index}`, '#2563eb'),
	);
	const theme = {
		muted: cssValue(styles, '--muted', '#6b7280'),
		border: cssValue(styles, '--border', '#e5e7eb'),
		surface: cssValue(styles, '--surface', '#ffffff'),
		font: cssValue(styles, '--mono', 'monospace'),
	};

	for (const [index, widget] of dashboard.widgets.entries()) {
		const result = results?.[index];
		if (widget.type === 'table' || !result || result.error) continue;

		const model = createChartModel(widget, result.data || []);
		if (typeof model === 'string' || model.error) continue;
		const canvas = container.querySelector(`[data-dashboard-chart="${index}"]`);
		if (!canvas) continue;

		const isPie = model.type === 'pie';
		const datasets = model.datasets.map((dataset, datasetIndex) => ({
			...dataset,
			backgroundColor: isPie
				? model.labels.map(
						(_, colorIndex) => colors[colorIndex % colors.length],
					)
				: colors[datasetIndex % colors.length],
			borderColor: isPie ? theme.surface : colors[datasetIndex % colors.length],
			borderWidth: isPie ? 2 : widget.type === 'line' ? 2.5 : 1,
			fill: false,
			pointBackgroundColor: colors[datasetIndex % colors.length],
			pointRadius: widget.type === 'line' ? 3 : 0,
			pointHoverRadius: widget.type === 'line' ? 5 : 0,
			tension: widget.type === 'line' ? 0.25 : 0,
		}));

		chartInstances.push(
			new globalThis.Chart(canvas, {
				type: model.type,
				data: {labels: model.labels, datasets},
				options: {
					responsive: true,
					maintainAspectRatio: false,
					animation: false,
					interaction: {mode: 'index', intersect: false},
					plugins: {
						legend: {
							position: 'bottom',
							labels: {
								color: theme.muted,
								boxWidth: 10,
								boxHeight: 10,
								padding: 16,
								font: {family: theme.font, size: 11},
							},
						},
						tooltip: {
							callbacks: {
								label: context => {
									const value = isPie ? context.parsed : context.parsed.y;
									return `${context.dataset.label}: ${formatNumber(value)}`;
								},
							},
						},
					},
					...(isPie
						? {}
						: {
								scales: {
									x: {
										grid: {display: false},
										border: {color: theme.border},
										ticks: {
											color: theme.muted,
											font: {family: theme.font, size: 10},
											maxRotation: 0,
											autoSkip: true,
											maxTicksLimit: 8,
										},
									},
									y: {
										beginAtZero: widget.type === 'bar',
										grid: {color: theme.border},
										border: {display: false},
										ticks: {
											color: theme.muted,
											font: {family: theme.font, size: 10},
											callback: value => formatNumber(value),
										},
									},
								},
							}),
				},
			}),
		);
	}
}

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
			else body = renderChart(widget, result.data || [], index);

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
