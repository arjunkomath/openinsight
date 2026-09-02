import {createAIClient} from './AIClient.js';
import {
	dashboardAgentResponseSchema,
	parseDashboardConfig,
} from './DashboardConfig.js';
import {executeQuery} from './QueryProcessor.js';

export async function generateDashboard(
	instruction,
	currentDashboard,
	schema,
	databaseType,
	aiConfig,
	onLog,
) {
	if (!aiConfig?.available) {
		return {
			error: aiConfig?.unavailableMessage || 'AI provider is unavailable',
			dashboard: null,
			message: null,
		};
	}

	try {
		const aiClient = createAIClient(aiConfig, onLog);
		onLog?.(
			currentDashboard
				? 'Revising dashboard with AI...'
				: 'Building dashboard with AI...',
		);
		const result = await aiClient.generateDashboard(
			instruction,
			schema,
			databaseType,
			currentDashboard,
		);
		if (result.error) {
			return {error: result.error, dashboard: null, message: null};
		}

		const parsed = dashboardAgentResponseSchema.safeParse({
			dashboard: result.dashboard,
			message: result.message,
		});
		if (!parsed.success) {
			const issue = parsed.error.issues[0];
			const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
			return {
				error: `Agent returned an invalid dashboard: ${path}${issue.message}`,
				dashboard: null,
				message: null,
			};
		}

		return {...parsed.data, error: null};
	} catch (error) {
		return {
			error: error.message || 'Unexpected error while building the dashboard',
			dashboard: null,
			message: null,
		};
	}
}

export async function runDashboard(
	dashboard,
	start,
	end,
	connectionString,
	schema,
	aiConfig,
	onLog,
) {
	const parsed = parseDashboardConfig(dashboard);
	if (parsed.error) return {error: parsed.error, results: null};

	const startDate = new Date(start);
	const endDate = new Date(end);
	if (
		!start ||
		!end ||
		!Number.isFinite(startDate.getTime()) ||
		!Number.isFinite(endDate.getTime())
	) {
		return {error: 'A valid start and end time are required', results: null};
	}
	if (startDate >= endDate) {
		return {error: 'The start time must be before the end time', results: null};
	}

	const parameters = [startDate.toISOString(), endDate.toISOString()];
	const results = await Promise.all(
		parsed.dashboard.widgets.map(async widget => {
			const result = await executeQuery(
				widget.sql,
				connectionString,
				schema,
				aiConfig,
				(message, options) => onLog?.(`[${widget.title}] ${message}`, options),
				undefined,
				parameters,
			);

			return {
				error: result.error,
				data: result.data,
				sql: result.sql,
			};
		}),
	);

	return {error: null, results};
}
