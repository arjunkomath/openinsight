import {readFileSync, writeFileSync, existsSync, mkdirSync} from 'fs';
import {join} from 'path';

export const getConfigDir = () => join(process.cwd(), '.openinsight');
const getConfigFile = () => join(getConfigDir(), 'config.json');

function loadConfig() {
	if (!existsSync(getConfigFile())) {
		return {version: '1.0.0', dataSources: [], presets: {}, dashboards: {}};
	}

	const content = readFileSync(getConfigFile(), 'utf-8');
	const config = JSON.parse(content);
	return {
		version: config.version || '1.0.0',
		...config,
		dataSources: config.dataSources || [],
		presets: config.presets || {},
		dashboards: config.dashboards || {},
	};
}

function writeConfig(config) {
	mkdirSync(getConfigDir(), {recursive: true});
	writeFileSync(getConfigFile(), JSON.stringify(config, null, 2), 'utf-8');
}

export function loadDataSources() {
	try {
		return loadConfig().dataSources;
	} catch {
		return [];
	}
}

export function saveDataSources(dataSources) {
	try {
		const config = loadConfig();
		writeConfig({
			...config,
			lastModified: new Date().toISOString(),
			dataSources,
		});
		return true;
	} catch {
		return false;
	}
}

export function addDataSource(source) {
	const sources = loadDataSources();

	if (sources.some(s => s.id === source.id || s.name === source.name)) {
		return {
			success: false,
			error: 'A data source with this name already exists',
		};
	}

	sources.push(source);
	const saved = saveDataSources(sources);
	return {success: saved, error: saved ? null : 'Failed to save configuration'};
}

export function removeDataSource(id) {
	try {
		const config = loadConfig();
		const filtered = config.dataSources.filter(source => source.id !== id);

		if (filtered.length === config.dataSources.length) {
			return false;
		}

		const presets = {...config.presets};
		delete presets[id];
		const dashboards = {...config.dashboards};
		delete dashboards[id];

		writeConfig({
			...config,
			dataSources: filtered,
			presets,
			dashboards,
			lastModified: new Date().toISOString(),
		});
		return true;
	} catch {
		return false;
	}
}

export function getDataSource(id) {
	const sources = loadDataSources();
	return sources.find(s => s.id === id) || null;
}

export function loadPresets(sourceId) {
	try {
		const presets = loadConfig().presets || {};
		return presets[sourceId] || [];
	} catch {
		return [];
	}
}

export function savePreset(sourceId, preset) {
	try {
		const config = loadConfig();

		const sourcePresets = config.presets[sourceId] || [];

		if (sourcePresets.some(p => p.name === preset.name)) {
			return {success: false, error: 'A preset with this name already exists'};
		}

		sourcePresets.push({
			id: crypto.randomUUID(),
			name: preset.name,
			sql: preset.sql,
			createdAt: new Date().toISOString(),
		});

		config.presets[sourceId] = sourcePresets;
		config.lastModified = new Date().toISOString();

		writeConfig(config);
		return {success: true};
	} catch (error) {
		return {success: false, error: error.message};
	}
}

export function removePreset(sourceId, presetId) {
	try {
		if (!existsSync(getConfigFile())) return false;

		const config = loadConfig();
		if (!config.presets || !config.presets[sourceId]) return false;

		config.presets[sourceId] = config.presets[sourceId].filter(
			p => p.id !== presetId,
		);
		config.lastModified = new Date().toISOString();

		writeConfig(config);
		return true;
	} catch {
		return false;
	}
}

export function loadDashboards(sourceId) {
	try {
		return loadConfig().dashboards[sourceId] || [];
	} catch {
		return [];
	}
}

export function saveDashboard(sourceId, dashboard, prompt) {
	try {
		const config = loadConfig();
		const dashboards = config.dashboards[sourceId] || [];
		if (dashboards.some(item => item.title === dashboard.title)) {
			return {
				success: false,
				error: 'A dashboard with this title already exists',
			};
		}

		const now = new Date().toISOString();
		const saved = {
			id: crypto.randomUUID(),
			...dashboard,
			prompt,
			createdAt: now,
			updatedAt: now,
		};
		dashboards.push(saved);
		config.dashboards[sourceId] = dashboards;
		config.lastModified = now;
		writeConfig(config);
		return {success: true, dashboard: saved};
	} catch (error) {
		return {success: false, error: error.message};
	}
}

export function updateDashboard(sourceId, dashboardId, dashboard) {
	try {
		const config = loadConfig();
		const dashboards = config.dashboards[sourceId] || [];
		const index = dashboards.findIndex(item => item.id === dashboardId);
		if (index === -1) return {success: false, error: 'Dashboard not found'};
		if (
			dashboards.some(
				item => item.id !== dashboardId && item.title === dashboard.title,
			)
		) {
			return {
				success: false,
				error: 'A dashboard with this title already exists',
			};
		}

		const saved = {
			...dashboards[index],
			...dashboard,
			id: dashboardId,
			updatedAt: new Date().toISOString(),
		};
		dashboards[index] = saved;
		config.dashboards[sourceId] = dashboards;
		config.lastModified = saved.updatedAt;
		writeConfig(config);
		return {success: true, dashboard: saved};
	} catch (error) {
		return {success: false, error: error.message};
	}
}

export function removeDashboard(sourceId, dashboardId) {
	try {
		if (!existsSync(getConfigFile())) return false;
		const config = loadConfig();
		const dashboards = config.dashboards[sourceId] || [];
		const filtered = dashboards.filter(item => item.id !== dashboardId);
		if (filtered.length === dashboards.length) return false;

		config.dashboards[sourceId] = filtered;
		config.lastModified = new Date().toISOString();
		writeConfig(config);
		return true;
	} catch {
		return false;
	}
}
