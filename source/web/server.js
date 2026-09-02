import process from 'node:process';
import appJs from './client/app.js' with {type: 'text'};
import dashboardJs from './client/dashboard.js' with {type: 'text'};
import faviconSvg from './client/favicon.svg' with {type: 'text'};
import fontMedium from './client/fonts/IoskeleyMono-Medium.woff2' with {type: 'file'};
import fontRegular from './client/fonts/IoskeleyMono-Regular.woff2' with {type: 'file'};
import indexHtml from './client/index.html' with {type: 'text'};
import stylesCss from './client/styles.css' with {type: 'text'};
import {
	addDataSource,
	getDataSource,
	loadDashboards,
	loadDataSources,
	loadPresets,
	getConfigDir,
	removeDashboard,
	removeDataSource,
	removePreset,
	saveDashboard,
	savePreset,
	updateDashboard,
} from '../utils/ConfigManager.js';
import {
	testConnection,
	validateConnectionString,
} from '../utils/DbConnector.js';
import {
	executeQuery,
	fetchSchema,
	generateQuery,
} from '../utils/QueryProcessor.js';
import {publicAIStatus, resolveAIConfig} from '../utils/AIConfig.js';
import {createLogHandler} from '../utils/Logger.js';
import {generateDashboard, runDashboard} from '../utils/DashboardProcessor.js';
import {parseDashboardConfig} from '../utils/DashboardConfig.js';

const schemas = new Map();
let configuredAI;
let configuredFileLog;
const assets = {
	'/': {body: indexHtml, contentType: 'text/html; charset=utf-8'},
	'/index.html': {body: indexHtml, contentType: 'text/html; charset=utf-8'},
	'/app.js': {body: appJs, contentType: 'text/javascript; charset=utf-8'},
	'/dashboard.js': {
		body: dashboardJs,
		contentType: 'text/javascript; charset=utf-8',
	},
	'/styles.css': {body: stylesCss, contentType: 'text/css; charset=utf-8'},
	'/favicon.svg': {
		body: faviconSvg,
		contentType: 'image/svg+xml; charset=utf-8',
	},
	'/fonts/IoskeleyMono-Regular.woff2': {
		body: Bun.file(fontRegular),
		contentType: 'font/woff2',
	},
	'/fonts/IoskeleyMono-Medium.woff2': {
		body: Bun.file(fontMedium),
		contentType: 'font/woff2',
	},
};

const json = (body, status = 200) =>
	new Response(
		JSON.stringify(body, (_key, value) =>
			typeof value === 'bigint' ? value.toString() : value,
		),
		{
			status,
			headers: {'content-type': 'application/json; charset=utf-8'},
		},
	);

const notFound = () => json({error: 'Not found'}, 404);

const publicSource = source => ({
	id: source.id,
	name: source.name,
	type: source.type,
});

const parseJson = async request => {
	try {
		return await request.json();
	} catch {
		return null;
	}
};

const getSourceOrResponse = sourceId => {
	const source = getDataSource(sourceId);
	return source || json({error: 'Data source not found'}, 404);
};

const loadSchemaForSource = async source => {
	const cached = schemas.get(source.id);
	if (cached) return {schema: cached, error: null};

	const result = await fetchSchema(source.connectionString, source.type);
	if (!result.error) {
		schemas.set(source.id, result.schema);
	}

	return result;
};

const routeApi = async (request, url) => {
	if (url.pathname === '/api/status' && request.method === 'GET') {
		return json({
			...publicAIStatus(configuredAI),
			configDir: getConfigDir(),
		});
	}

	if (url.pathname === '/api/sources' && request.method === 'GET') {
		return json({sources: loadDataSources().map(publicSource)});
	}

	if (url.pathname === '/api/sources' && request.method === 'POST') {
		const body = await parseJson(request);
		const name = body?.name?.trim();
		const connectionString = body?.connectionString?.trim();

		if (!name) return json({error: 'Data source name is required'}, 400);

		const validation = validateConnectionString(connectionString);
		if (!validation.isValid) return json({error: validation.error}, 400);

		const connection = await testConnection(connectionString);
		if (!connection.success) return json({error: connection.error}, 400);

		const source = {
			id: crypto.randomUUID(),
			name,
			connectionString,
			type: validation.protocol,
		};
		const result = addDataSource(source);
		if (!result.success) return json({error: result.error}, 400);

		return json({source: publicSource(source)}, 201);
	}

	const sourceMatch = url.pathname.match(
		/^\/api\/sources\/([^/]+)(?:\/(.*))?$/,
	);
	if (sourceMatch) {
		const [, sourceId, suffix = ''] = sourceMatch;

		if (suffix === '' && request.method === 'DELETE') {
			const removed = removeDataSource(sourceId);
			schemas.delete(sourceId);
			return removed ? json({success: true}) : json({error: 'Not found'}, 404);
		}

		const source = getSourceOrResponse(sourceId);
		if (source instanceof Response) return source;

		if (suffix === 'schema' && request.method === 'GET') {
			const result = await loadSchemaForSource(source);
			if (result.error) return json({error: result.error}, 400);
			return json({schema: result.schema});
		}

		if (suffix === 'presets' && request.method === 'GET') {
			return json({presets: loadPresets(sourceId)});
		}

		if (suffix === 'dashboards' && request.method === 'GET') {
			return json({dashboards: loadDashboards(sourceId)});
		}

		if (suffix === 'dashboards/generate' && request.method === 'POST') {
			const body = await parseJson(request);
			const instruction = body?.instruction?.trim();
			if (!instruction) return json({error: 'An instruction is required'}, 400);
			if (!configuredAI.available) {
				return json({error: configuredAI.unavailableMessage}, 400);
			}

			let currentDashboard = null;
			if (body?.currentDashboard) {
				const parsed = parseDashboardConfig(body.currentDashboard);
				if (parsed.error) return json({error: parsed.error}, 400);
				currentDashboard = parsed.dashboard;
			}

			const schemaResult = await loadSchemaForSource(source);
			if (schemaResult.error) return json({error: schemaResult.error}, 400);
			const logs = [];
			const onLog = createLogHandler({
				uiLog: message => logs.push(message),
				fileLog: configuredFileLog,
				verbose: configuredAI.verbose,
			});
			const result = await generateDashboard(
				instruction,
				currentDashboard,
				schemaResult.schema,
				source.type,
				configuredAI,
				onLog,
			);
			return json({...result, logs});
		}

		if (suffix === 'dashboards/run' && request.method === 'POST') {
			const body = await parseJson(request);
			const schemaResult = await loadSchemaForSource(source);
			if (schemaResult.error) return json({error: schemaResult.error}, 400);
			const logs = [];
			const onLog = createLogHandler({
				uiLog: message => logs.push(message),
				fileLog: configuredFileLog,
				verbose: configuredAI.verbose,
			});
			const result = await runDashboard(
				body?.dashboard,
				body?.start,
				body?.end,
				source.connectionString,
				schemaResult.schema,
				configuredAI,
				onLog,
			);
			return json({...result, logs});
		}

		if (suffix === 'dashboards' && request.method === 'POST') {
			const body = await parseJson(request);
			const parsed = parseDashboardConfig(body?.dashboard);
			if (parsed.error) return json({error: parsed.error}, 400);
			const result = saveDashboard(
				sourceId,
				parsed.dashboard,
				body?.prompt?.trim() || '',
			);
			if (!result.success) return json({error: result.error}, 400);
			return json({dashboard: result.dashboard}, 201);
		}

		const dashboardMatch = suffix.match(/^dashboards\/([^/]+)$/);
		if (dashboardMatch && request.method === 'PUT') {
			const body = await parseJson(request);
			const parsed = parseDashboardConfig(body?.dashboard);
			if (parsed.error) return json({error: parsed.error}, 400);
			const result = updateDashboard(
				sourceId,
				dashboardMatch[1],
				parsed.dashboard,
			);
			if (!result.success) {
				return json(
					{error: result.error},
					result.error === 'Dashboard not found' ? 404 : 400,
				);
			}
			return json({dashboard: result.dashboard});
		}

		if (dashboardMatch && request.method === 'DELETE') {
			const removed = removeDashboard(sourceId, dashboardMatch[1]);
			return removed ? json({success: true}) : json({error: 'Not found'}, 404);
		}

		if (suffix === 'presets' && request.method === 'POST') {
			const body = await parseJson(request);
			const name = body?.name?.trim();
			const sql = body?.sql?.trim();
			if (!name || !sql) return json({error: 'Name and SQL are required'}, 400);

			const result = savePreset(sourceId, {name, sql});
			if (!result.success) return json({error: result.error}, 400);
			return json({presets: loadPresets(sourceId)}, 201);
		}

		const presetMatch = suffix.match(/^presets\/([^/]+)$/);
		if (presetMatch && request.method === 'DELETE') {
			const removed = removePreset(sourceId, presetMatch[1]);
			return removed ? json({success: true}) : json({error: 'Not found'}, 404);
		}
	}

	if (url.pathname === '/api/query/generate' && request.method === 'POST') {
		const body = await parseJson(request);
		const source = getSourceOrResponse(body?.sourceId);
		if (source instanceof Response) return source;
		if (!configuredAI.available) {
			return json({error: configuredAI.unavailableMessage}, 400);
		}

		const schemaResult = await loadSchemaForSource(source);
		if (schemaResult.error) return json({error: schemaResult.error}, 400);

		const logs = [];
		const onLog = createLogHandler({
			uiLog: message => logs.push(message),
			fileLog: configuredFileLog,
			verbose: configuredAI.verbose,
		});
		const result = await generateQuery(
			body?.query || '',
			schemaResult.schema,
			configuredAI,
			body?.history || [],
			onLog,
		);

		return json({...result, logs});
	}

	if (url.pathname === '/api/query/execute' && request.method === 'POST') {
		const body = await parseJson(request);
		const source = getSourceOrResponse(body?.sourceId);
		if (source instanceof Response) return source;

		const schemaResult = await loadSchemaForSource(source);
		if (schemaResult.error) return json({error: schemaResult.error}, 400);

		const logs = [];
		const onLog = createLogHandler({
			uiLog: message => logs.push(message),
			fileLog: configuredFileLog,
			verbose: configuredAI.verbose,
		});
		const result = await executeQuery(
			body?.sql || '',
			source.connectionString,
			schemaResult.schema,
			configuredAI,
			onLog,
		);

		return json({...result, logs});
	}

	return notFound();
};

const serveStatic = async url => {
	const asset = assets[url.pathname] || assets['/index.html'];

	return new Response(asset.body, {
		headers: {'content-type': asset.contentType},
	});
};

const openInBrowser = url => {
	const command =
		process.platform === 'darwin'
			? ['open', url]
			: process.platform === 'win32'
				? ['cmd', '/c', 'start', '', url]
				: ['xdg-open', url];

	try {
		Bun.spawn(command, {stdout: 'ignore', stderr: 'ignore'}).unref();
	} catch {
		// Launching a browser is best effort; the URL is printed either way.
	}
};

export function startWebServer({
	host = '127.0.0.1',
	port = 5678,
	open = true,
	aiConfig = resolveAIConfig(),
	fileLog,
} = {}) {
	configuredAI = aiConfig;
	configuredFileLog = fileLog;
	const server = Bun.serve({
		host,
		port,
		async fetch(request) {
			const url = new URL(request.url);

			try {
				if (url.pathname.startsWith('/api/')) {
					return await routeApi(request, url);
				}

				return serveStatic(url);
			} catch (error) {
				return json({error: error.message || 'Unexpected server error'}, 500);
			}
		},
	});

	if (host === '0.0.0.0') {
		console.warn('Warning: web mode is listening on all interfaces.');
	}

	const reachableHost =
		server.hostname === '0.0.0.0' || server.hostname === '::'
			? 'localhost'
			: server.hostname;
	const url = `http://${reachableHost}:${server.port}`;

	console.log(`OpenInsight web running at ${url}`);
	console.log(`Config: ${getConfigDir()}`);

	if (open) openInBrowser(url);

	return server;
}
