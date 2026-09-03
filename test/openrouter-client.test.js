import {expect, test} from 'bun:test';
import {createOpenRouterClient} from '../source/utils/OpenRouterClient.js';

const createProvider = () => model => ({model});

test('OpenRouter client redacts its API key from verbose provider metadata', async () => {
	const apiKey = 'sk-or-secret';
	const logs = [];
	const client = createOpenRouterClient(
		apiKey,
		'test/model',
		message => logs.push(message),
		{
			verbose: true,
			createProvider,
			generate: async () => ({
				object: {sql: 'SELECT 1 LIMIT 1000'},
				usage: {inputTokens: 1, outputTokens: 2},
				finishReason: 'stop',
				warnings: [],
				providerMetadata: {debug: apiKey},
				request: {body: {debug: apiKey}},
				response: {headers: {'x-debug': apiKey}},
			}),
		},
	);

	const result = await client.generateSQL('show one', {users: []}, []);
	const output = logs.join('\n');
	expect(result).toEqual({sql: 'SELECT 1 LIMIT 1000', error: null});
	expect(output).toContain('[Verbose][OpenRouter] Generation result:');
	expect(output).toContain('<redacted-api-key>');
	expect(output).not.toContain(apiKey);
});

test('OpenRouter client redacts its API key from returned errors', async () => {
	const apiKey = 'sk-or-secret';
	const logs = [];
	const client = createOpenRouterClient(
		apiKey,
		'test/model',
		message => logs.push(message),
		{
			verbose: true,
			createProvider,
			generate: async () => {
				throw new Error(`Provider echoed ${apiKey}`);
			},
		},
	);

	const result = await client.generateSQL('show one', {}, []);
	expect(result.error).toContain('<redacted-api-key>');
	expect(result.error).not.toContain(apiKey);
	expect(logs.join('\n')).not.toContain(apiKey);
});

test('OpenRouter client summarizes query results with an optional instruction', async () => {
	let request;
	const client = createOpenRouterClient('key', 'test/model', null, {
		createProvider,
		generate: async options => {
			request = options;
			return {object: {summary: 'Revenue increased by 20%.'}};
		},
	});

	const result = await client.summarizeResults(
		'How is revenue changing?',
		'SELECT revenue FROM sales',
		[{revenue: 120n}],
		'Compare with the prior period',
	);

	expect(result).toEqual({summary: 'Revenue increased by 20%.', error: null});
	expect(request.messages[0].content).toContain('How is revenue changing?');
	expect(request.messages[0].content).toContain('"revenue": "120"');
	expect(request.messages[0].content).toContain(
		'Compare with the prior period',
	);
});

test('OpenRouter client generates complete editable dashboard configs', async () => {
	let request;
	const controller = new AbortController();
	const dashboard = {
		title: 'Orders',
		description: 'Order volume',
		defaultRange: {type: 'relative', days: 30},
		widgets: [
			{
				type: 'bar',
				title: 'Orders by status',
				subtitle: 'Order count grouped by current status',
				width: 'full',
				sql: 'SELECT status, COUNT(*) AS orders FROM orders WHERE created_at >= $1 AND created_at < $2 GROUP BY status LIMIT 1000',
				x: 'status',
				y: ['orders'],
			},
		],
	};
	const client = createOpenRouterClient('key', 'test/model', null, {
		createProvider,
		generate: async options => {
			request = options;
			return {object: {dashboard, message: 'Changed the chart to bars.'}};
		},
	});

	const result = await client.generateDashboard(
		'Use a bar chart',
		{orders: [{column: 'created_at', type: 'timestamp'}]},
		'postgres',
		{...dashboard, title: 'Old title'},
		controller.signal,
	);

	expect(result).toEqual({
		dashboard,
		message: 'Changed the chart to bars.',
		error: null,
	});
	expect(request.system).toContain('$1 as the inclusive start time');
	expect(request.system).toContain('concise subtitle');
	expect(request.abortSignal).toBe(controller.signal);
	expect(request.messages[0].content).toContain('Old title');
});
