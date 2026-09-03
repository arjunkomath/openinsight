import {z} from 'zod';
import {isReadOnlyQuery} from './SqlSafety.js';

const dashboardSqlSchema = z
	.string()
	.min(1)
	.max(50_000)
	.refine(isReadOnlyQuery, 'Only SELECT and WITH queries are allowed')
	.refine(sql => /\$1\b/.test(sql) && /\$2\b/.test(sql), {
		message: 'Dashboard queries must use $1 for the start and $2 for the end',
	});

const widgetBase = {
	title: z.string().trim().min(1).max(120),
	subtitle: z.string().trim().max(240),
	sql: dashboardSqlSchema,
	width: z.enum(['half', 'full']),
};

const tableWidgetSchema = z.object({
	...widgetBase,
	type: z.literal('table'),
});

const cartesianWidgetSchema = z.object({
	...widgetBase,
	type: z.enum(['line', 'bar']),
	x: z.string().trim().min(1).max(120),
	y: z.array(z.string().trim().min(1).max(120)).min(1).max(4),
});

const pieWidgetSchema = z.object({
	...widgetBase,
	type: z.literal('pie'),
	label: z.string().trim().min(1).max(120),
	value: z.string().trim().min(1).max(120),
});

export const dashboardConfigSchema = z.object({
	title: z.string().trim().min(1).max(120),
	description: z.string().trim().max(500),
	defaultRange: z.object({
		type: z.literal('relative'),
		days: z.number().int().min(1).max(3650),
	}),
	widgets: z
		.array(z.union([tableWidgetSchema, cartesianWidgetSchema, pieWidgetSchema]))
		.min(1)
		.max(8),
});

export const dashboardAgentResponseSchema = z.object({
	dashboard: dashboardConfigSchema,
	message: z.string().trim().min(1).max(500),
});

export const dashboardAgentJsonSchema = JSON.stringify(
	z.toJSONSchema(dashboardAgentResponseSchema),
);

export function parseDashboardConfig(value) {
	const normalized =
		value && typeof value === 'object' && Array.isArray(value.widgets)
			? {
					...value,
					widgets: value.widgets.map(widget =>
						widget &&
						typeof widget === 'object' &&
						!Object.hasOwn(widget, 'subtitle')
							? {...widget, subtitle: ''}
							: widget,
					),
				}
			: value;
	const parsed = dashboardConfigSchema.safeParse(normalized);
	if (parsed.success) return {dashboard: parsed.data, error: null};

	const issue = parsed.error.issues[0];
	const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
	return {dashboard: null, error: `${path}${issue.message}`};
}
