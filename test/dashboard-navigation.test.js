import {expect, test} from 'bun:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

test('switching tabs during generation cannot select a saved dashboard', async () => {
	const source = readFileSync(
		new URL('../source/web/client/app.js', import.meta.url),
		'utf8',
	);
	const section = (from, to) =>
		source.slice(source.indexOf(from), source.indexOf(to));
	const saved = {id: 'saved', title: 'Existing dashboard'};
	const state = {
		view: 'dashboards',
		busy: 'dashboard-generate',
		dashboardDirty: false,
		dashboardDraft: null,
		selectedDashboardId: null,
		dashboards: [saved],
	};
	const context = {
		state,
		el: {dashboardInstruction: {value: 'Build a new dashboard'}},
		isBusy: () => state.busy !== null,
		setState: patch => Object.assign(state, patch),
		copyValue: structuredClone,
		relativeRange: days => ({days}),
		executeDashboard: async () => {},
	};
	runInNewContext(
		section('const selectDashboard =', 'const newDashboard =') +
			section('const switchView =', 'const cancelDashboardGeneration =') +
			'globalThis.switchView = switchView;',
		context,
	);
	await context.switchView('query');
	await context.switchView('dashboards');
	expect(state.selectedDashboardId).toBeNull();
	expect(state.dashboardDraft).toBeNull();
	expect(context.el.dashboardInstruction.value).toBe('Build a new dashboard');

	state.busy = null;
	await context.switchView('dashboards');
	expect(state.selectedDashboardId).toBe('saved');
	expect(state.dashboardDraft).toEqual(saved);
});
