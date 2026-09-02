import {renderDashboardGrid} from './dashboard.js';

const MAX_RENDERED_ROWS = 500;

const state = {
	view: 'query',
	status: null,
	sources: [],
	selectedSourceId: null,
	schema: null,
	schemaError: '',
	schemaLoading: false,
	schemaFilter: '',
	expandedTables: new Set(),
	presets: [],
	dashboards: [],
	selectedDashboardId: null,
	dashboardDraft: null,
	dashboardDirty: false,
	dashboardResults: null,
	dashboardRange: null,
	dashboardMessage: '',
	dashboardCreationPrompt: '',
	dashboardLogs: [],
	turns: [],
	messages: [],
	pendingSql: '',
	results: null,
	resultsSql: '',
	logs: [],
	busy: null,
	error: '',
	openSections: {
		sources: true,
		dashboards: true,
		presets: true,
		history: true,
		schema: true,
	},
	confirming: null,
};

let confirmTimer = null;
let elapsedTimer = null;
let busyStartedAt = 0;

const updateElapsed = () => {
	const seconds = Math.round((Date.now() - busyStartedAt) / 1000);
	for (const node of document.querySelectorAll('.elapsed')) {
		node.textContent = `${seconds}s`;
	}
};

const startElapsed = () => {
	busyStartedAt = Date.now();
	clearInterval(elapsedTimer);
	elapsedTimer = setInterval(updateElapsed, 1000);
};

const stopElapsed = () => {
	clearInterval(elapsedTimer);
	elapsedTimer = null;
};

const api = async (path, options = {}) => {
	const response = await fetch(path, {
		...options,
		headers: {
			'content-type': 'application/json',
			...(options.headers || {}),
		},
	});
	const data = await response.json();
	if (!response.ok) throw new Error(data.error || 'Request failed');
	return data;
};

const escapeHtml = value =>
	String(value ?? '')
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#039;');

const selectedSource = () =>
	state.sources.find(source => source.id === state.selectedSourceId) || null;

const isBusy = () => state.busy !== null;

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

document.querySelector('#app').innerHTML = `
	<div class="app">
		<header class="topbar">
			<div class="identity">
				<span class="brand">OpenInsight</span>
				<nav class="topnav" aria-label="Workspace">
					<button class="topnav-button" data-action="switch-view" data-view="query">Query</button>
					<button class="topnav-button" data-action="switch-view" data-view="dashboards">Dashboards</button>
				</nav>
				<span class="crumb" id="crumb"></span>
			</div>
			<div class="topbar-meta" id="topbar-meta"></div>
		</header>

		<div class="body">
			<aside class="sidebar">
				<section class="rail" data-section="sources">
					<div class="rail-head">
						<button class="rail-toggle" data-action="toggle-section" data-section="sources">
							<span class="chevron"></span>Sources
						</button>
						<button class="icon-button" data-action="open-source-dialog" title="Add data source">+</button>
					</div>
					<div class="rail-body" id="source-list"></div>
				</section>

				<section class="rail dashboard-only" data-section="dashboards">
						<div class="rail-head">
							<button class="rail-toggle" data-action="toggle-section" data-section="dashboards">
								<span class="chevron"></span>Dashboards
							</button>
							<button class="icon-button" data-action="new-dashboard" title="Build dashboard">+</button>
						</div>
						<div class="rail-body" id="dashboard-list"></div>
					</section>

					<section class="rail query-only" data-section="presets">
					<div class="rail-head">
						<button class="rail-toggle" data-action="toggle-section" data-section="presets">
							<span class="chevron"></span>Presets
						</button>
						<span class="rail-count" id="preset-count"></span>
					</div>
					<div class="rail-body" id="preset-list"></div>
				</section>

				<section class="rail query-only" data-section="history">
					<div class="rail-head">
						<button class="rail-toggle" data-action="toggle-section" data-section="history">
							<span class="chevron"></span>Session
						</button>
						<button class="text-button" data-action="clear-context" id="clear-context">Clear</button>
					</div>
					<div class="rail-body" id="history-list"></div>
				</section>

				<section class="rail rail-grow" data-section="schema">
					<div class="rail-head">
						<button class="rail-toggle" data-action="toggle-section" data-section="schema">
							<span class="chevron"></span>Schema
						</button>
						<span class="rail-count" id="schema-count"></span>
					</div>
					<div class="rail-body rail-body-scroll">
						<input id="schema-filter" type="search" placeholder="Filter tables and columns" />
						<div id="schema-list"></div>
					</div>
				</section>
			</aside>

			<main class="workspace" id="query-workspace">
				<div id="banner"></div>

				<section class="panel onboarding" id="onboarding" hidden>
					<h1>Connect a database to get started</h1>
					<p>Ask questions in plain English, review the SQL before it runs, and keep the queries you want to reuse. Everything stays in this project's <code>.openinsight</code> folder.</p>
					<div class="actions">
						<button class="primary" data-action="open-source-dialog" type="button">Add data source</button>
					</div>
					<div class="examples">
						<span class="pill"><span class="pill-name">sqlite://./data.db</span></span>
						<span class="pill"><span class="pill-name">postgres://user:pass@localhost:5432/db</span></span>
						<span class="pill"><span class="pill-name">mysql://user:pass@localhost:3306/db</span></span>
					</div>
				</section>

				<form class="panel composer" id="query-form">
					<div class="panel-head">
						<span class="eyebrow">Ask</span>
						<span class="hint">⌘⏎ to generate</span>
					</div>
					<textarea id="query-input" name="query" rows="3" placeholder="Ask a question about your data…"></textarea>
					<div class="actions">
						<button class="primary" id="generate-button" type="submit">Generate SQL</button>
						<span class="muted" id="composer-status"></span>
					</div>
				</form>

				<section class="panel sql-panel" id="sql-panel" hidden>
					<div class="panel-head">
						<span class="eyebrow">SQL</span>
						<div class="head-actions">
							<button class="text-button" data-action="copy-sql" type="button">Copy</button>
							<button class="text-button" data-action="open-preset-dialog" type="button">Save preset</button>
						</div>
					</div>
					<textarea id="sql-editor" class="sql" spellcheck="false" rows="6"></textarea>
					<div class="actions">
						<button class="primary" data-action="run-sql" type="button" id="run-button">Run query</button>
						<span class="hint">⌘⏎ to run</span>
					</div>
				</section>

				<section class="results" id="results"></section>

				<div id="activity"></div>
			</main>

			<main class="workspace dashboard-workspace" id="dashboard-workspace" hidden>
				<div id="dashboard-banner"></div>

				<section class="panel placeholder" id="dashboard-no-source" hidden>
					Select a data source before building a dashboard.
				</section>

				<form class="panel dashboard-agent" id="dashboard-agent-form">
					<div class="panel-head">
						<span class="eyebrow" id="dashboard-agent-title">Build with agent</span>
						<span class="hint">The agent controls widgets, SQL, charts, and layout</span>
					</div>
					<textarea id="dashboard-instruction" rows="3" placeholder="Build a dashboard for revenue, orders, and top customers…"></textarea>
					<div class="actions">
						<button class="primary" id="dashboard-generate-button" type="submit">Build dashboard</button>
						<span class="muted" id="dashboard-agent-status"></span>
					</div>
				</form>

				<section id="dashboard-preview" hidden>
					<div class="dashboard-titlebar">
						<div>
							<div class="dashboard-title-line">
								<h1 id="dashboard-title"></h1>
								<span class="tag tag-warn" id="dashboard-unsaved" hidden>Unsaved changes</span>
							</div>
							<p id="dashboard-description"></p>
						</div>
						<div class="head-actions">
							<button class="text-button" data-action="discard-dashboard" id="dashboard-discard" type="button">Discard changes</button>
							<button class="primary" data-action="save-dashboard" id="dashboard-save" type="button">Save dashboard</button>
						</div>
					</div>

					<div class="agent-message" id="dashboard-message" hidden></div>

					<div class="panel range-toolbar">
						<div class="range-presets" aria-label="Time range">
							<button data-action="set-dashboard-range" data-days="7" type="button">7 days</button>
							<button data-action="set-dashboard-range" data-days="30" type="button">30 days</button>
							<button data-action="set-dashboard-range" data-days="90" type="button">90 days</button>
						</div>
						<div class="range-custom">
							<label>From <input id="dashboard-range-start" type="datetime-local" /></label>
							<label>To <input id="dashboard-range-end" type="datetime-local" /></label>
							<button class="primary" data-action="run-dashboard" id="dashboard-run" type="button">Run dashboard</button>
						</div>
					</div>

					<div class="dashboard-grid" id="dashboard-grid"></div>
				</section>

				<div id="dashboard-activity"></div>
			</main>
		</div>
	</div>

	<dialog id="source-dialog">
		<form method="dialog" class="dialog-body" id="source-form">
			<h2>Add data source</h2>
			<label for="source-name">Name</label>
			<input id="source-name" name="name" placeholder="Local analytics" required />
			<label for="source-connection">Connection string</label>
			<input id="source-connection" name="connectionString" placeholder="sqlite://./data.db" required />
			<p class="hint">Supports postgres://, mysql:// and sqlite:// — the connection is tested before it is saved.</p>
			<div class="dialog-error" id="source-dialog-error" hidden></div>
			<div class="dialog-actions">
				<button type="button" data-action="close-dialog" data-dialog="source-dialog">Cancel</button>
				<button class="primary" type="submit" id="source-submit">Add and test</button>
			</div>
		</form>
	</dialog>

	<dialog id="preset-dialog">
		<form method="dialog" class="dialog-body" id="preset-form">
			<h2>Save preset</h2>
			<label for="preset-name">Name</label>
			<input id="preset-name" name="name" placeholder="Weekly signups" required />
			<p class="hint">Saves the SQL currently in the editor for this source.</p>
			<div class="dialog-error" id="preset-dialog-error" hidden></div>
			<div class="dialog-actions">
				<button type="button" data-action="close-dialog" data-dialog="preset-dialog">Cancel</button>
				<button class="primary" type="submit">Save</button>
			</div>
		</form>
	</dialog>
`;

const el = {
	crumb: document.querySelector('#crumb'),
	topbarMeta: document.querySelector('#topbar-meta'),
	sourceList: document.querySelector('#source-list'),
	dashboardList: document.querySelector('#dashboard-list'),
	presetList: document.querySelector('#preset-list'),
	presetCount: document.querySelector('#preset-count'),
	historyList: document.querySelector('#history-list'),
	clearContext: document.querySelector('#clear-context'),
	schemaCount: document.querySelector('#schema-count'),
	schemaFilter: document.querySelector('#schema-filter'),
	schemaList: document.querySelector('#schema-list'),
	banner: document.querySelector('#banner'),
	onboarding: document.querySelector('#onboarding'),
	queryForm: document.querySelector('#query-form'),
	queryInput: document.querySelector('#query-input'),
	generateButton: document.querySelector('#generate-button'),
	composerStatus: document.querySelector('#composer-status'),
	sqlPanel: document.querySelector('#sql-panel'),
	sqlEditor: document.querySelector('#sql-editor'),
	runButton: document.querySelector('#run-button'),
	results: document.querySelector('#results'),
	activity: document.querySelector('#activity'),
	sourceDialog: document.querySelector('#source-dialog'),
	sourceForm: document.querySelector('#source-form'),
	sourceDialogError: document.querySelector('#source-dialog-error'),
	presetDialog: document.querySelector('#preset-dialog'),
	presetForm: document.querySelector('#preset-form'),
	presetDialogError: document.querySelector('#preset-dialog-error'),
	queryWorkspace: document.querySelector('#query-workspace'),
	dashboardWorkspace: document.querySelector('#dashboard-workspace'),
	dashboardBanner: document.querySelector('#dashboard-banner'),
	dashboardNoSource: document.querySelector('#dashboard-no-source'),
	dashboardAgentForm: document.querySelector('#dashboard-agent-form'),
	dashboardAgentTitle: document.querySelector('#dashboard-agent-title'),
	dashboardInstruction: document.querySelector('#dashboard-instruction'),
	dashboardGenerateButton: document.querySelector('#dashboard-generate-button'),
	dashboardAgentStatus: document.querySelector('#dashboard-agent-status'),
	dashboardPreview: document.querySelector('#dashboard-preview'),
	dashboardTitle: document.querySelector('#dashboard-title'),
	dashboardDescription: document.querySelector('#dashboard-description'),
	dashboardUnsaved: document.querySelector('#dashboard-unsaved'),
	dashboardDiscard: document.querySelector('#dashboard-discard'),
	dashboardSave: document.querySelector('#dashboard-save'),
	dashboardMessage: document.querySelector('#dashboard-message'),
	dashboardRangeStart: document.querySelector('#dashboard-range-start'),
	dashboardRangeEnd: document.querySelector('#dashboard-range-end'),
	dashboardRun: document.querySelector('#dashboard-run'),
	dashboardGrid: document.querySelector('#dashboard-grid'),
	dashboardActivity: document.querySelector('#dashboard-activity'),
};

const setState = patch => {
	Object.assign(state, patch);
	render();
};

const confirmLabel = (id, label) =>
	state.confirming === id ? 'Confirm?' : label;

const armConfirm = id => {
	clearTimeout(confirmTimer);
	setState({confirming: id});
	confirmTimer = setTimeout(() => {
		if (state.confirming === id) setState({confirming: null});
	}, 4000);
};

const copyValue = value => JSON.parse(JSON.stringify(value));

const toLocalInput = date => {
	const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
	return local.toISOString().slice(0, 16);
};

const relativeRange = days => {
	const end = new Date();
	const start = new Date(end);
	start.setDate(start.getDate() - days);
	return {
		mode: 'relative',
		days,
		start: toLocalInput(start),
		end: toLocalInput(end),
	};
};

const renderView = () => {
	const dashboards = state.view === 'dashboards';
	el.queryWorkspace.hidden = dashboards;
	el.dashboardWorkspace.hidden = !dashboards;
	for (const node of document.querySelectorAll('.query-only'))
		node.hidden = dashboards;
	for (const node of document.querySelectorAll('.dashboard-only'))
		node.hidden = !dashboards;
	for (const button of document.querySelectorAll('.topnav-button')) {
		button.classList.toggle('is-active', button.dataset.view === state.view);
	}
};

const renderTopbar = () => {
	const source = selectedSource();
	const tableCount = state.schema ? Object.keys(state.schema).length : null;

	el.crumb.innerHTML = source
		? `${escapeHtml(source.name)}<span class="sep">/</span>${escapeHtml(source.type)}${
				tableCount === null
					? ''
					: `<span class="sep">/</span>${plural(tableCount, 'table')}`
			}`
		: '<span class="muted">No source selected</span>';

	const model = state.status?.model;
	const provider = state.status?.provider;
	el.topbarMeta.innerHTML = [
		model
			? `<span class="tag" title="Model used for SQL generation">${escapeHtml(provider ? `${provider} / ${model}` : model)}</span>`
			: '',
		state.status && !state.status.available
			? '<span class="tag tag-warn">AI unavailable</span>'
			: '',
		state.status?.verbose ? '<span class="tag tag-warn">Verbose</span>' : '',
		state.status?.logging ? '<span class="tag tag-warn">Logging</span>' : '',
		state.status?.configDir
			? `<span class="tag tag-quiet" title="${escapeHtml(state.status.configDir)}">Local config</span>`
			: '',
	].join('');
};

const renderSources = () => {
	if (state.sources.length === 0) {
		el.sourceList.innerHTML = `
			<p class="empty-line">No sources yet.</p>
			<button class="text-button" data-action="open-source-dialog">Add a data source</button>
		`;
		return;
	}

	el.sourceList.innerHTML = state.sources
		.map(source => {
			const active = source.id === state.selectedSourceId;
			return `
				<div class="row ${active ? 'row-active' : ''}">
					<button class="row-main" data-action="select-source" data-id="${source.id}" ${isBusy() ? 'disabled' : ''}>
						<span class="row-title">${escapeHtml(source.name)}</span>
						<span class="row-sub">${escapeHtml(source.type)}</span>
					</button>
					${
						active
							? `<button class="danger text-button" data-action="delete-source" data-id="${source.id}">${confirmLabel(
									`source:${source.id}`,
									'Delete',
								)}</button>`
							: ''
					}
				</div>
			`;
		})
		.join('');
};

const renderDashboardList = () => {
	if (!state.selectedSourceId) {
		el.dashboardList.innerHTML =
			'<p class="empty-line">Select a source first.</p>';
		return;
	}
	if (state.dashboards.length === 0) {
		el.dashboardList.innerHTML =
			'<p class="empty-line">Ask the agent to build your first dashboard.</p>';
		return;
	}

	el.dashboardList.innerHTML = state.dashboards
		.map(dashboard => {
			const active = dashboard.id === state.selectedDashboardId;
			return `
				<div class="row ${active ? 'row-active' : ''}">
					<button class="row-main" data-action="select-dashboard" data-id="${dashboard.id}" ${isBusy() ? 'disabled' : ''}>
						<span class="row-title">${escapeHtml(dashboard.title)}</span>
					</button>
					<button class="danger text-button" data-action="delete-dashboard" data-id="${dashboard.id}">${confirmLabel(
						`dashboard:${dashboard.id}`,
						'Delete',
					)}</button>
				</div>
			`;
		})
		.join('');
};

const renderPresets = () => {
	el.presetCount.textContent = state.presets.length || '';

	if (!state.selectedSourceId) {
		el.presetList.innerHTML =
			'<p class="empty-line">Select a source first.</p>';
		return;
	}

	if (state.presets.length === 0) {
		el.presetList.innerHTML =
			'<p class="empty-line">Save a query to reuse it later.</p>';
		return;
	}

	el.presetList.innerHTML = state.presets
		.map(
			preset => `
				<div class="row">
					<button class="row-main" data-action="use-preset" data-id="${preset.id}" title="Load into the SQL editor">
						<span class="row-title">${escapeHtml(preset.name)}</span>
					</button>
					<button class="text-button" data-action="run-preset" data-id="${preset.id}" ${isBusy() ? 'disabled' : ''}>Run</button>
					<button class="danger text-button" data-action="delete-preset" data-id="${preset.id}">${confirmLabel(
						`preset:${preset.id}`,
						'Delete',
					)}</button>
				</div>
			`,
		)
		.join('');
};

const renderHistory = () => {
	el.clearContext.hidden = state.turns.length === 0;

	if (state.turns.length === 0) {
		el.historyList.innerHTML = `
			<p class="empty-line">Questions you ask are kept as context for follow-ups.</p>
		`;
		return;
	}

	el.historyList.innerHTML = state.turns
		.map(
			(turn, index) => `
				<div class="row">
					<button class="row-main" data-action="use-turn" data-id="${turn.id}" title="Reload this question and its SQL">
						<span class="row-index">${state.turns.length - index}</span>
						<span class="row-title row-title-clamp">${escapeHtml(turn.question)}</span>
					</button>
				</div>
			`,
		)
		.join('');
};

const matchesFilter = (table, columns, filter) => {
	if (!filter) return {matched: true, columns};
	if (table.toLowerCase().includes(filter)) return {matched: true, columns};
	const hits = columns.filter(column =>
		column.column.toLowerCase().includes(filter),
	);
	return {matched: hits.length > 0, columns: hits};
};

const renderSchema = () => {
	if (!state.selectedSourceId) {
		el.schemaCount.textContent = '';
		el.schemaList.innerHTML =
			'<p class="empty-line">Select a source to browse its schema.</p>';
		return;
	}

	if (state.schemaLoading) {
		el.schemaList.innerHTML = '<p class="empty-line">Loading schema…</p>';
		return;
	}

	if (state.schemaError) {
		el.schemaCount.textContent = '';
		el.schemaList.innerHTML = `<p class="empty-line danger-text">${escapeHtml(state.schemaError)}</p>`;
		return;
	}

	if (!state.schema) {
		el.schemaList.innerHTML = '';
		return;
	}

	const entries = Object.entries(state.schema);
	el.schemaCount.textContent = entries.length || '';

	const filter = state.schemaFilter.trim().toLowerCase();
	const rendered = entries
		.map(([table, columns]) => ({
			table,
			...matchesFilter(table, columns, filter),
		}))
		.filter(entry => entry.matched);

	if (rendered.length === 0) {
		el.schemaList.innerHTML = `<p class="empty-line">No tables match “${escapeHtml(state.schemaFilter)}”.</p>`;
		return;
	}

	el.schemaList.innerHTML = rendered
		.map(({table, columns}) => {
			const open = filter ? true : state.expandedTables.has(table);
			return `
				<div class="schema-table ${open ? 'is-open' : ''}">
					<button class="schema-toggle" data-action="toggle-table" data-id="${escapeHtml(table)}">
						<span class="chevron"></span>
						<span class="schema-name">${escapeHtml(table)}</span>
						<span class="rail-count">${columns.length}</span>
					</button>
					${
						open
							? `<div class="schema-columns">${columns
									.map(
										column =>
											`<span class="pill"><span class="pill-name">${escapeHtml(column.column)}</span><span class="pill-type">${escapeHtml(column.type)}</span></span>`,
									)
									.join('')}</div>`
							: ''
					}
				</div>
			`;
		})
		.join('');
};

const renderBanner = () => {
	const messages = [];

	if (state.status && !state.status.available) {
		messages.push(
			`<div class="notice">${escapeHtml(state.status.unavailableMessage)}. You can still write and run SQL by hand.</div>`,
		);
	}

	if (state.error) {
		messages.push(
			`<div class="error"><span>${escapeHtml(state.error)}</span><button class="text-button" data-action="dismiss-error">Dismiss</button></div>`,
		);
	}

	el.banner.innerHTML = messages.join('');
};

const renderComposer = () => {
	const ready = Boolean(state.selectedSourceId);
	const canGenerate = ready && state.status?.available !== false;
	const onboarding = state.status !== null && state.sources.length === 0;

	el.onboarding.hidden = !onboarding;
	el.queryForm.hidden = onboarding;

	el.queryInput.disabled = !canGenerate || isBusy();
	el.queryInput.placeholder = ready
		? 'Ask a question about your data…'
		: 'Select a data source to start';
	el.generateButton.disabled = !canGenerate || isBusy();
	el.generateButton.textContent =
		state.busy === 'generate' ? 'Generating…' : 'Generate SQL';

	el.composerStatus.innerHTML =
		state.busy === 'generate'
			? 'Asking the model for SQL <span class="elapsed">0s</span>'
			: state.turns.length > 0
				? `Follow-ups use the last ${plural(Math.min(state.turns.length, 5), 'question')} as context`
				: '';
};

const renderSqlPanel = () => {
	const visible = Boolean(state.pendingSql) || Boolean(state.selectedSourceId);
	el.sqlPanel.hidden = !visible;
	if (!visible) return;

	if (el.sqlEditor.value !== state.pendingSql) {
		el.sqlEditor.value = state.pendingSql;
	}

	el.sqlEditor.disabled = isBusy();
	el.sqlEditor.placeholder = 'SELECT * FROM …';
	el.runButton.disabled = isBusy() || !state.pendingSql.trim();
	el.runButton.textContent = state.busy === 'run' ? 'Running…' : 'Run query';
};

const isNumericColumn = (rows, column) => {
	const sample = rows.slice(0, 20).map(row => row[column]);
	const values = sample.filter(value => value !== null && value !== undefined);
	return values.length > 0 && values.every(value => typeof value === 'number');
};

const formatCell = value => {
	if (value === null || value === undefined)
		return '<span class="null">NULL</span>';
	if (typeof value === 'object')
		return escapeHtml(JSON.stringify(value, null, 2));
	if (typeof value === 'boolean') return `<span class="bool">${value}</span>`;
	return escapeHtml(value);
};

const renderResults = () => {
	if (state.busy === 'run') {
		el.results.innerHTML = `
			<div class="panel placeholder">
				<div>Running query… <span class="elapsed">0s</span></div>
				<div class="placeholder-sub">If the database rejects the SQL, the model rewrites and retries it up to twice.</div>
			</div>
		`;
		return;
	}

	if (!state.results) {
		el.results.innerHTML = state.selectedSourceId
			? '<div class="panel placeholder">Results appear here once you run a query.</div>'
			: '';
		return;
	}

	if (state.results.length === 0) {
		el.results.innerHTML =
			'<div class="panel placeholder">Query ran successfully and returned no rows.</div>';
		return;
	}

	const columns = Object.keys(state.results[0]);
	const rows = state.results.slice(0, MAX_RENDERED_ROWS);
	const alignment = Object.fromEntries(
		columns.map(column => [column, isNumericColumn(state.results, column)]),
	);
	const truncated = state.results.length > rows.length;

	el.results.innerHTML = `
		<section class="panel results-panel">
			<div class="panel-head results-head">
				<span class="eyebrow">${plural(state.results.length, 'row')}<span class="sep">/</span>${plural(columns.length, 'column')}${
					truncated
						? `<span class="sep">/</span>showing first ${MAX_RENDERED_ROWS}`
						: ''
				}</span>
				<div class="head-actions">
					<span class="tag tag-stale" id="stale-tag" hidden>SQL edited since this ran</span>
					<button class="text-button" data-action="download-csv">Download CSV</button>
					<button class="text-button" data-action="copy-json">Copy JSON</button>
				</div>
			</div>
			<div class="table-wrap">
				<table>
					<thead>
						<tr>
							<th class="gutter"></th>
							${columns
								.map(
									column =>
										`<th class="${alignment[column] ? 'num' : ''}">${escapeHtml(column)}</th>`,
								)
								.join('')}
						</tr>
					</thead>
					<tbody>
						${rows
							.map(
								(row, index) =>
									`<tr><td class="gutter">${index + 1}</td>${columns
										.map(
											column =>
												`<td class="${alignment[column] ? 'num' : ''}">${formatCell(row[column])}</td>`,
										)
										.join('')}</tr>`,
							)
							.join('')}
					</tbody>
				</table>
			</div>
		</section>
	`;
	syncStaleTag();
};

const syncStaleTag = () => {
	const tag = document.querySelector('#stale-tag');
	if (!tag) return;
	tag.hidden = state.pendingSql.trim() === state.resultsSql.trim();
};

const renderActivity = () => {
	if (state.logs.length === 0) {
		el.activity.innerHTML = '';
		return;
	}

	el.activity.innerHTML = `
		<details class="activity" ${state.status?.verbose ? 'open' : ''}>
			<summary>Activity<span class="rail-count">${state.logs.length}</span></summary>
			<div class="timeline">${state.logs.map(log => `<div>${escapeHtml(log)}</div>`).join('')}</div>
		</details>
	`;
};

const renderDashboardBanner = () => {
	const messages = [];
	if (state.status && !state.status.available) {
		messages.push(
			`<div class="notice">${escapeHtml(state.status.unavailableMessage)}. Dashboard creation and editing require an agent.</div>`,
		);
	}
	if (state.error) {
		messages.push(
			`<div class="error"><span>${escapeHtml(state.error)}</span><button class="text-button" data-action="dismiss-error">Dismiss</button></div>`,
		);
	}
	el.dashboardBanner.innerHTML = messages.join('');
};

const renderDashboardWorkspace = () => {
	const draft = state.dashboardDraft;
	const hasSource = Boolean(state.selectedSourceId);
	const generating = state.busy === 'dashboard-generate';
	const running = state.busy === 'dashboard-run';

	el.dashboardNoSource.hidden = hasSource;
	el.dashboardAgentForm.hidden = !hasSource;
	el.dashboardInstruction.disabled =
		!hasSource || state.status?.available === false || isBusy();
	el.dashboardGenerateButton.disabled =
		!hasSource || state.status?.available === false || isBusy();
	el.dashboardAgentTitle.textContent = draft
		? 'Edit with agent'
		: 'Build with agent';
	el.dashboardInstruction.placeholder = draft
		? 'Ask the agent to add, remove, reorder, or change any part of this dashboard…'
		: 'Build a dashboard for revenue, orders, and top customers…';
	el.dashboardGenerateButton.textContent = generating
		? draft
			? 'Revising…'
			: 'Building…'
		: draft
			? 'Revise dashboard'
			: 'Build dashboard';
	el.dashboardAgentStatus.innerHTML = generating
		? 'Asking the agent <span class="elapsed">0s</span>'
		: '';

	el.dashboardPreview.hidden = !draft;
	if (!draft) {
		el.dashboardActivity.innerHTML = '';
		return;
	}

	el.dashboardTitle.textContent = draft.title;
	el.dashboardDescription.textContent = draft.description;
	el.dashboardUnsaved.hidden = !state.dashboardDirty;
	el.dashboardDiscard.hidden = !state.dashboardDirty;
	el.dashboardSave.hidden = !state.dashboardDirty;
	el.dashboardSave.textContent = state.selectedDashboardId
		? 'Save changes'
		: 'Save dashboard';
	el.dashboardSave.disabled = isBusy();
	el.dashboardMessage.hidden = !state.dashboardMessage;
	el.dashboardMessage.textContent = state.dashboardMessage;

	const range =
		state.dashboardRange || relativeRange(draft.defaultRange?.days || 30);
	if (el.dashboardRangeStart.value !== range.start)
		el.dashboardRangeStart.value = range.start;
	if (el.dashboardRangeEnd.value !== range.end)
		el.dashboardRangeEnd.value = range.end;
	el.dashboardRangeStart.disabled = isBusy();
	el.dashboardRangeEnd.disabled = isBusy();
	for (const button of document.querySelectorAll(
		'[data-action="set-dashboard-range"]',
	)) {
		button.classList.toggle(
			'is-active',
			range.mode === 'relative' && Number(button.dataset.days) === range.days,
		);
		button.disabled = isBusy();
	}
	el.dashboardRun.disabled = isBusy();
	el.dashboardRun.textContent = running ? 'Running…' : 'Run dashboard';
	el.dashboardGrid.innerHTML = renderDashboardGrid(
		draft,
		state.dashboardResults,
		running,
	);

	if (state.dashboardLogs.length === 0) {
		el.dashboardActivity.innerHTML = '';
	} else {
		el.dashboardActivity.innerHTML = `
			<details class="activity" ${state.status?.verbose ? 'open' : ''}>
				<summary>Activity<span class="rail-count">${state.dashboardLogs.length}</span></summary>
				<div class="timeline">${state.dashboardLogs.map(log => `<div>${escapeHtml(log)}</div>`).join('')}</div>
			</details>
		`;
	}
};

const renderSectionStates = () => {
	for (const [section, open] of Object.entries(state.openSections)) {
		document
			.querySelector(`.rail[data-section="${section}"]`)
			?.classList.toggle('is-collapsed', !open);
	}
};

const render = () => {
	renderView();
	renderTopbar();
	renderSources();
	renderDashboardList();
	renderPresets();
	renderHistory();
	renderSchema();
	renderSectionStates();
	renderBanner();
	renderComposer();
	renderSqlPanel();
	renderResults();
	renderActivity();
	renderDashboardBanner();
	renderDashboardWorkspace();
};

const loadSources = async () => {
	const {sources} = await api('/api/sources');
	setState({sources});
	return sources;
};

const selectSource = async sourceId => {
	if (sourceId === state.selectedSourceId) return;
	if (state.dashboardDirty) {
		setState({error: 'Save or discard the current dashboard changes first'});
		return;
	}

	setState({
		selectedSourceId: sourceId,
		schema: null,
		schemaError: '',
		schemaLoading: true,
		schemaFilter: '',
		expandedTables: new Set(),
		presets: [],
		dashboards: [],
		selectedDashboardId: null,
		dashboardDraft: null,
		dashboardDirty: false,
		dashboardResults: null,
		dashboardRange: null,
		dashboardMessage: '',
		dashboardCreationPrompt: '',
		dashboardLogs: [],
		results: null,
		pendingSql: '',
		logs: [],
		messages: [],
		turns: [],
		error: '',
	});
	el.schemaFilter.value = '';
	el.queryInput.value = '';

	try {
		const [schemaResult, presetResult, dashboardResult] =
			await Promise.allSettled([
				api(`/api/sources/${sourceId}/schema`),
				api(`/api/sources/${sourceId}/presets`),
				api(`/api/sources/${sourceId}/dashboards`),
			]);

		if (sourceId !== state.selectedSourceId) return;

		const dashboards =
			dashboardResult.status === 'fulfilled'
				? dashboardResult.value.dashboards
				: [];
		setState({
			schema:
				schemaResult.status === 'fulfilled' ? schemaResult.value.schema : null,
			schemaError:
				schemaResult.status === 'rejected' ? schemaResult.reason.message : '',
			presets:
				presetResult.status === 'fulfilled' ? presetResult.value.presets : [],
			dashboards,
			schemaLoading: false,
		});
		if (state.view === 'dashboards' && dashboards.length > 0) {
			await selectDashboard(dashboards[0].id);
		}
	} catch (error) {
		setState({schemaLoading: false, error: error.message});
	}
};

const selectDashboard = async dashboardId => {
	if (state.dashboardDirty) {
		setState({error: 'Save or discard the current dashboard changes first'});
		return;
	}
	if (dashboardId === state.selectedDashboardId && state.dashboardDraft) return;
	const dashboard = state.dashboards.find(item => item.id === dashboardId);
	if (!dashboard) return;

	el.dashboardInstruction.value = '';
	setState({
		selectedDashboardId: dashboard.id,
		dashboardDraft: copyValue(dashboard),
		dashboardDirty: false,
		dashboardResults: null,
		dashboardRange: relativeRange(dashboard.defaultRange?.days || 30),
		dashboardMessage: '',
		dashboardCreationPrompt: dashboard.prompt || '',
		dashboardLogs: [],
		error: '',
	});
	await executeDashboard();
};

const newDashboard = () => {
	if (state.dashboardDirty) {
		setState({error: 'Save or discard the current dashboard changes first'});
		return;
	}
	el.dashboardInstruction.value = '';
	setState({
		selectedDashboardId: null,
		dashboardDraft: null,
		dashboardDirty: false,
		dashboardResults: null,
		dashboardRange: null,
		dashboardMessage: '',
		dashboardCreationPrompt: '',
		dashboardLogs: [],
		error: '',
	});
	el.dashboardInstruction.focus();
};

const switchView = async view => {
	if (!['query', 'dashboards'].includes(view)) return;
	setState({view, error: ''});
	if (
		view === 'dashboards' &&
		!state.dashboardDraft &&
		state.dashboards.length > 0
	) {
		await selectDashboard(state.dashboards[0].id);
	}
};

const generateDashboardDraft = async event => {
	event.preventDefault();
	const instruction = el.dashboardInstruction.value.trim();
	if (!instruction || !state.selectedSourceId || isBusy()) return;

	const editing = Boolean(state.dashboardDraft);
	startElapsed();
	setState({
		busy: 'dashboard-generate',
		error: '',
		dashboardLogs: [],
		dashboardMessage: '',
	});
	try {
		const result = await api(
			`/api/sources/${state.selectedSourceId}/dashboards/generate`,
			{
				method: 'POST',
				body: JSON.stringify({
					instruction,
					currentDashboard: state.dashboardDraft,
				}),
			},
		);
		if (result.error) {
			setState({
				error: result.error,
				dashboardLogs: result.logs || [],
				busy: null,
			});
			return;
		}

		el.dashboardInstruction.value = '';
		setState({
			dashboardDraft: result.dashboard,
			dashboardDirty: true,
			dashboardResults: null,
			dashboardRange: relativeRange(result.dashboard.defaultRange.days),
			dashboardMessage: result.message || '',
			dashboardCreationPrompt: editing
				? state.dashboardCreationPrompt
				: instruction,
			dashboardLogs: result.logs || [],
			busy: null,
		});
		await executeDashboard();
	} catch (error) {
		setState({error: error.message, busy: null});
	} finally {
		stopElapsed();
	}
};

async function executeDashboard() {
	if (!state.dashboardDraft || !state.selectedSourceId || isBusy()) return;
	let range = state.dashboardRange;
	if (!range || range.mode === 'relative') {
		range = relativeRange(
			range?.days || state.dashboardDraft.defaultRange?.days || 30,
		);
	}
	const start = new Date(range.start);
	const end = new Date(range.end);
	if (
		!Number.isFinite(start.getTime()) ||
		!Number.isFinite(end.getTime()) ||
		start >= end
	) {
		setState({
			error: 'Choose a valid time range with the start before the end',
		});
		return;
	}

	const previousLogs = state.dashboardLogs;
	startElapsed();
	setState({
		busy: 'dashboard-run',
		error: '',
		dashboardResults: null,
		dashboardRange: range,
	});
	try {
		const result = await api(
			`/api/sources/${state.selectedSourceId}/dashboards/run`,
			{
				method: 'POST',
				body: JSON.stringify({
					dashboard: state.dashboardDraft,
					start: start.toISOString(),
					end: end.toISOString(),
				}),
			},
		);
		const logs = [...previousLogs, ...(result.logs || [])];
		if (result.error) {
			setState({error: result.error, dashboardLogs: logs, busy: null});
			return;
		}
		const repairedWidgets = state.dashboardDraft.widgets.map(
			(widget, index) => {
				const executed = result.results?.[index];
				return !executed?.error && executed?.sql && executed.sql !== widget.sql
					? {...widget, sql: executed.sql}
					: widget;
			},
		);
		const repaired = repairedWidgets.some(
			(widget, index) => widget !== state.dashboardDraft.widgets[index],
		);
		setState({
			dashboardDraft: repaired
				? {...state.dashboardDraft, widgets: repairedWidgets}
				: state.dashboardDraft,
			dashboardDirty: state.dashboardDirty || repaired,
			dashboardMessage: repaired
				? 'The agent repaired one or more widget queries. Save to keep the repairs.'
				: state.dashboardMessage,
			dashboardResults: result.results || [],
			dashboardLogs: logs,
			busy: null,
		});
	} catch (error) {
		setState({error: error.message, busy: null});
	} finally {
		stopElapsed();
	}
}

const saveDashboardDraft = async () => {
	if (!state.dashboardDraft || !state.dashboardDirty || isBusy()) return;
	const existingId = state.selectedDashboardId;
	const path = existingId
		? `/api/sources/${state.selectedSourceId}/dashboards/${existingId}`
		: `/api/sources/${state.selectedSourceId}/dashboards`;

	setState({busy: 'dashboard-save', error: ''});
	try {
		const {dashboard} = await api(path, {
			method: existingId ? 'PUT' : 'POST',
			body: JSON.stringify({
				dashboard: state.dashboardDraft,
				prompt: state.dashboardCreationPrompt,
			}),
		});
		const dashboards = existingId
			? state.dashboards.map(item =>
					item.id === existingId ? dashboard : item,
				)
			: [...state.dashboards, dashboard];
		setState({
			dashboards,
			selectedDashboardId: dashboard.id,
			dashboardDraft: copyValue(dashboard),
			dashboardDirty: false,
			dashboardMessage: 'Saved to local config.',
			busy: null,
		});
	} catch (error) {
		setState({error: error.message, busy: null});
	}
};

const discardDashboardDraft = async () => {
	if (!state.dashboardDirty || isBusy()) return;
	if (!state.selectedDashboardId) {
		el.dashboardInstruction.value = '';
		setState({
			dashboardDraft: null,
			dashboardDirty: false,
			dashboardResults: null,
			dashboardRange: null,
			dashboardMessage: '',
			dashboardCreationPrompt: '',
			dashboardLogs: [],
			error: '',
		});
		return;
	}
	const saved = state.dashboards.find(
		item => item.id === state.selectedDashboardId,
	);
	if (!saved) return;
	setState({
		dashboardDraft: copyValue(saved),
		dashboardDirty: false,
		dashboardResults: null,
		dashboardRange: relativeRange(saved.defaultRange?.days || 30),
		dashboardMessage: '',
		dashboardLogs: [],
	});
	await executeDashboard();
};

const deleteDashboard = async dashboardId => {
	if (state.dashboardDirty && dashboardId !== state.selectedDashboardId) {
		setState({error: 'Save or discard the current dashboard changes first'});
		return;
	}
	if (state.confirming !== `dashboard:${dashboardId}`) {
		armConfirm(`dashboard:${dashboardId}`);
		return;
	}

	setState({confirming: null});
	try {
		await api(
			`/api/sources/${state.selectedSourceId}/dashboards/${dashboardId}`,
			{method: 'DELETE'},
		);
		const dashboards = state.dashboards.filter(item => item.id !== dashboardId);
		setState({
			dashboards,
			selectedDashboardId: null,
			dashboardDraft: null,
			dashboardDirty: false,
			dashboardResults: null,
			dashboardRange: null,
			dashboardMessage: '',
			dashboardLogs: [],
		});
		if (dashboards.length > 0) await selectDashboard(dashboards[0].id);
	} catch (error) {
		setState({error: error.message});
	}
};

const addSource = async event => {
	event.preventDefault();
	const form = new FormData(el.sourceForm);
	el.sourceDialogError.hidden = true;
	setState({busy: 'source'});

	try {
		const {source} = await api('/api/sources', {
			method: 'POST',
			body: JSON.stringify({
				name: form.get('name'),
				connectionString: form.get('connectionString'),
			}),
		});
		el.sourceForm.reset();
		el.sourceDialog.close();
		setState({sources: [...state.sources, source], busy: null});
		await selectSource(source.id);
	} catch (error) {
		el.sourceDialogError.textContent = error.message;
		el.sourceDialogError.hidden = false;
		setState({busy: null});
	}
};

const deleteSource = async sourceId => {
	if (state.dashboardDirty) {
		setState({error: 'Save or discard the current dashboard changes first'});
		return;
	}
	if (state.confirming !== `source:${sourceId}`) {
		armConfirm(`source:${sourceId}`);
		return;
	}

	setState({busy: 'source', confirming: null});
	try {
		await api(`/api/sources/${sourceId}`, {method: 'DELETE'});
		const sources = state.sources.filter(source => source.id !== sourceId);
		setState({
			sources,
			selectedSourceId: null,
			schema: null,
			presets: [],
			dashboards: [],
			selectedDashboardId: null,
			dashboardDraft: null,
			dashboardDirty: false,
			dashboardResults: null,
			dashboardRange: null,
			dashboardMessage: '',
			dashboardLogs: [],
			results: null,
			pendingSql: '',
			turns: [],
			messages: [],
			busy: null,
		});
		if (sources.length > 0) await selectSource(sources[0].id);
	} catch (error) {
		setState({error: error.message, busy: null});
	}
};

const generateSql = async event => {
	event.preventDefault();
	const query = el.queryInput.value.trim();
	if (!query || !state.selectedSourceId || isBusy()) return;

	startElapsed();
	setState({
		busy: 'generate',
		error: '',
		logs: [],
		pendingSql: '',
		results: null,
	});
	try {
		const result = await api('/api/query/generate', {
			method: 'POST',
			body: JSON.stringify({
				sourceId: state.selectedSourceId,
				query,
				history: state.messages.slice(-10),
			}),
		});
		if (result.error) {
			setState({
				error: result.error,
				logs: result.logs || [],
				busy: null,
			});
			return;
		}

		setState({
			pendingSql: result.sql || '',
			logs: result.logs || [],
			messages: [...state.messages, {role: 'user', content: query}],
			turns: [
				{id: crypto.randomUUID(), question: query, sql: result.sql || ''},
				...state.turns,
			],
			busy: null,
		});
		el.sqlEditor.focus();
	} catch (error) {
		setState({error: error.message, busy: null});
	} finally {
		stopElapsed();
	}
};

const executeSql = async () => {
	const sql = state.pendingSql.trim();
	if (!sql || !state.selectedSourceId || isBusy()) return;

	const generationLogs = state.logs;
	startElapsed();
	setState({busy: 'run', error: '', results: null});
	try {
		const result = await api('/api/query/execute', {
			method: 'POST',
			body: JSON.stringify({sourceId: state.selectedSourceId, sql}),
		});
		const logs = [...generationLogs, ...(result.logs || [])];
		if (result.error) {
			setState({error: result.error, logs, busy: null});
			return;
		}

		const finalSql = result.sql || sql;
		setState({
			pendingSql: finalSql,
			resultsSql: finalSql,
			results: result.data || [],
			logs,
			messages: [...state.messages, {role: 'assistant', content: finalSql}],
			turns: state.turns.map((turn, index) =>
				index === 0 ? {...turn, sql: finalSql} : turn,
			),
			busy: null,
		});
	} catch (error) {
		setState({error: error.message, busy: null});
	} finally {
		stopElapsed();
	}
};

const savePreset = async event => {
	event.preventDefault();
	const name = new FormData(el.presetForm).get('name')?.trim();
	const sql = state.pendingSql.trim();
	if (!name || !sql) return;

	el.presetDialogError.hidden = true;
	try {
		const {presets} = await api(
			`/api/sources/${state.selectedSourceId}/presets`,
			{method: 'POST', body: JSON.stringify({name, sql})},
		);
		el.presetForm.reset();
		el.presetDialog.close();
		setState({presets});
	} catch (error) {
		el.presetDialogError.textContent = error.message;
		el.presetDialogError.hidden = false;
	}
};

const deletePreset = async presetId => {
	if (state.confirming !== `preset:${presetId}`) {
		armConfirm(`preset:${presetId}`);
		return;
	}

	setState({confirming: null});
	try {
		await api(`/api/sources/${state.selectedSourceId}/presets/${presetId}`, {
			method: 'DELETE',
		});
		setState({presets: state.presets.filter(preset => preset.id !== presetId)});
	} catch (error) {
		setState({error: error.message});
	}
};

const downloadCsv = () => {
	if (!state.results?.length) return;

	const columns = Object.keys(state.results[0]);
	const cell = value => {
		if (value === null || value === undefined) return '';
		const text =
			typeof value === 'object' ? JSON.stringify(value) : String(value);
		return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
	};

	const csv = [
		columns.map(cell).join(','),
		...state.results.map(row =>
			columns.map(column => cell(row[column])).join(','),
		),
	].join('\n');

	const url = URL.createObjectURL(new Blob([csv], {type: 'text/csv'}));
	const link = document.createElement('a');
	link.href = url;
	link.download = `openinsight-${Date.now()}.csv`;
	link.click();
	URL.revokeObjectURL(url);
};

const flashButton = (button, label) => {
	const original = button.textContent;
	button.textContent = label;
	setTimeout(() => {
		button.textContent = original;
	}, 1200);
};

const copyToClipboard = async (text, button) => {
	try {
		await navigator.clipboard.writeText(text);
		flashButton(button, 'Copied');
	} catch {
		flashButton(button, 'Copy failed');
	}
};

const actions = {
	'switch-view': button => switchView(button.dataset.view),
	'new-dashboard': newDashboard,
	'select-dashboard': button => selectDashboard(button.dataset.id),
	'delete-dashboard': button => deleteDashboard(button.dataset.id),
	'save-dashboard': saveDashboardDraft,
	'discard-dashboard': discardDashboardDraft,
	'run-dashboard': executeDashboard,
	'set-dashboard-range': async button => {
		const days = Number(button.dataset.days);
		setState({dashboardRange: relativeRange(days)});
		await executeDashboard();
	},
	'toggle-section': button => {
		const section = button.dataset.section;
		setState({
			openSections: {
				...state.openSections,
				[section]: !state.openSections[section],
			},
		});
	},
	'toggle-table': button => {
		const table = button.dataset.id;
		const expanded = new Set(state.expandedTables);
		if (expanded.has(table)) expanded.delete(table);
		else expanded.add(table);
		setState({expandedTables: expanded});
	},
	'select-source': button => selectSource(button.dataset.id),
	'delete-source': button => deleteSource(button.dataset.id),
	'open-source-dialog': () => {
		el.sourceDialogError.hidden = true;
		el.sourceDialog.showModal();
	},
	'open-preset-dialog': () => {
		if (!state.pendingSql.trim()) return;
		el.presetDialogError.hidden = true;
		el.presetDialog.showModal();
	},
	'close-dialog': button => {
		document.querySelector(`#${button.dataset.dialog}`)?.close();
	},
	'use-preset': button => {
		const preset = state.presets.find(item => item.id === button.dataset.id);
		if (preset) setState({pendingSql: preset.sql, results: null, error: ''});
	},
	'run-preset': async button => {
		const preset = state.presets.find(item => item.id === button.dataset.id);
		if (!preset) return;
		setState({pendingSql: preset.sql, results: null, error: ''});
		await executeSql();
	},
	'delete-preset': button => deletePreset(button.dataset.id),
	'use-turn': button => {
		const turn = state.turns.find(item => item.id === button.dataset.id);
		if (!turn) return;
		el.queryInput.value = turn.question;
		setState({pendingSql: turn.sql, results: null, error: ''});
	},
	'clear-context': () => setState({turns: [], messages: []}),
	'dismiss-error': () => setState({error: ''}),
	'copy-sql': button => copyToClipboard(state.pendingSql, button),
	'copy-json': button =>
		copyToClipboard(JSON.stringify(state.results, null, 2), button),
	'download-csv': downloadCsv,
	'run-sql': executeSql,
};

document.addEventListener('click', event => {
	const button = event.target.closest('[data-action]');
	if (!button) return;
	const handler = actions[button.dataset.action];
	if (!handler) return;
	event.preventDefault();
	handler(button);
});

const submitOnMeta = (event, submit) => {
	if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
		event.preventDefault();
		submit();
	}
};

el.queryForm.addEventListener('submit', generateSql);
el.dashboardAgentForm.addEventListener('submit', generateDashboardDraft);
el.queryInput.addEventListener('keydown', event =>
	submitOnMeta(event, () => el.queryForm.requestSubmit()),
);
el.sqlEditor.addEventListener('input', event => {
	state.pendingSql = event.target.value;
	el.runButton.disabled = isBusy() || !state.pendingSql.trim();
	syncStaleTag();
});
el.sqlEditor.addEventListener('keydown', event =>
	submitOnMeta(event, executeSql),
);
el.schemaFilter.addEventListener('input', event => {
	state.schemaFilter = event.target.value;
	renderSchema();
});
el.sourceForm.addEventListener('submit', addSource);
el.presetForm.addEventListener('submit', savePreset);
el.dashboardInstruction.addEventListener('keydown', event =>
	submitOnMeta(event, () => el.dashboardAgentForm.requestSubmit()),
);
el.dashboardRangeStart.addEventListener('input', event => {
	setState({
		dashboardRange: {
			...(state.dashboardRange || {}),
			mode: 'custom',
			start: event.target.value,
			end: el.dashboardRangeEnd.value,
		},
	});
});
el.dashboardRangeEnd.addEventListener('input', event => {
	setState({
		dashboardRange: {
			...(state.dashboardRange || {}),
			mode: 'custom',
			start: el.dashboardRangeStart.value,
			end: event.target.value,
		},
	});
});

const init = async () => {
	render();
	try {
		const status = await api('/api/status');
		setState({status});
		const sources = await loadSources();
		if (sources.length > 0) await selectSource(sources[0].id);
	} catch (error) {
		setState({error: error.message});
	}
};

init();
