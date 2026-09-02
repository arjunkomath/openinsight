import {createConnection} from './DbConnector.js';
import {createAIClient} from './AIClient.js';
import {isAbortError, throwIfAborted} from './abort.js';
import {isReadOnlyQuery} from './SqlSafety.js';

async function getSchema(conn, dbType) {
	if (dbType === 'postgres' || dbType === 'postgresql') {
		const tables = await conn.query(`
			SELECT table_name, column_name, data_type
			FROM information_schema.columns
			WHERE table_schema = 'public'
			ORDER BY table_name, ordinal_position
		`);
		return formatSchema(tables);
	}

	if (dbType === 'mysql') {
		const tables = await conn.query(`
			SELECT table_name, column_name, data_type
			FROM information_schema.columns
			WHERE table_schema = DATABASE()
			ORDER BY table_name, ordinal_position
		`);
		return formatSchema(tables);
	}

	if (dbType === 'sqlite') {
		const tableList = await conn.query(`
			SELECT name FROM sqlite_master
			WHERE type='table' AND name NOT LIKE 'sqlite_%'
		`);

		const schema = {};
		for (const {name} of tableList) {
			const columns = await conn.query(`PRAGMA table_info(${name})`);
			schema[name] = columns.map(c => ({
				column: c.name,
				type: c.type,
			}));
		}
		return schema;
	}

	return {};
}

function formatSchema(rows) {
	const schema = {};
	for (const row of rows) {
		const tableName = row.table_name;
		if (!schema[tableName]) {
			schema[tableName] = [];
		}
		schema[tableName].push({
			column: row.column_name,
			type: row.data_type,
		});
	}
	return schema;
}

export async function fetchSchema(connectionString, dbType) {
	let conn;
	try {
		conn = await createConnection(connectionString);
	} catch (error) {
		return {schema: null, error: `Failed to connect: ${error.message}`};
	}

	try {
		const schema = await getSchema(conn, dbType);
		await conn.close();
		return {schema, error: null};
	} catch (error) {
		await conn.close();
		return {schema: null, error: `Failed to fetch schema: ${error.message}`};
	}
}

export async function generateQuery(
	naturalLanguageQuery,
	schema,
	aiConfig,
	history,
	onLog,
	abortSignal,
) {
	const log = (message, options) => onLog?.(message, options);
	const verboseLog = messageOrFactory => {
		if (!(aiConfig?.diagnostics ?? aiConfig?.verbose)) return;
		const message =
			typeof messageOrFactory === 'function'
				? messageOrFactory()
				: messageOrFactory;
		log(`[Verbose][Query] ${message}`, {verbose: true});
	};

	if (!aiConfig?.available) {
		return {
			error: aiConfig?.unavailableMessage || 'AI provider is unavailable',
			sql: null,
		};
	}

	const tableCount = Object.keys(schema).length;
	log(`Using cached schema (${tableCount} tables)`);
	verboseLog(`Provider: ${aiConfig.provider}`);
	verboseLog(`Model: ${aiConfig.model}`);
	verboseLog(`Natural-language query:\n${naturalLanguageQuery}`);
	verboseLog(() => `Schema:\n${formatVerboseValue(schema)}`);
	verboseLog(
		() => `Conversation history:\n${formatVerboseValue(history || [])}`,
	);

	try {
		throwIfAborted(abortSignal, 'Inference cancelled');

		const aiClient = createAIClient(aiConfig, log);
		log('Generating SQL with AI...');
		const startedAt = Date.now();
		const result = await aiClient.generateSQL(
			naturalLanguageQuery,
			schema,
			history || [],
			abortSignal,
		);
		verboseLog(`Inference completed in ${Date.now() - startedAt}ms`);
		verboseLog(() => `AI client result:\n${formatVerboseValue(result)}`);

		throwIfAborted(abortSignal, 'Inference cancelled');

		if (result.error) {
			return {error: result.error, sql: null};
		}

		const sql = result.sql;

		if (!isReadOnlyQuery(sql)) {
			verboseLog('Read-only validation rejected the generated SQL');
			return {error: 'Only SELECT queries are allowed', sql};
		}
		verboseLog('Read-only validation passed');

		return {error: null, sql};
	} catch (error) {
		if (isAbortError(error)) {
			log('Inference cancelled');
			return {cancelled: true, error: null, sql: null};
		}
		verboseLog(
			`Unhandled generation exception:\n${error.stack || error.message}`,
		);

		return {
			error: error.message || 'Unexpected error while generating SQL',
			sql: null,
		};
	}
}

export async function summarizeQueryResults(
	naturalLanguageQuery,
	sql,
	data,
	instruction,
	aiConfig,
	onLog,
	abortSignal,
) {
	const log = (message, options) => onLog?.(message, options);

	try {
		throwIfAborted(abortSignal, 'Summarization cancelled');
		const aiClient = createAIClient(aiConfig, log);
		log('Summarizing query results with AI...');
		const result = await aiClient.summarizeResults(
			naturalLanguageQuery,
			sql,
			data,
			instruction,
			abortSignal,
		);
		throwIfAborted(abortSignal, 'Summarization cancelled');
		return result;
	} catch (error) {
		if (isAbortError(error)) {
			return {cancelled: true, error: null, summary: null};
		}

		return {
			error: error.message || 'Unexpected error while summarizing results',
			summary: null,
		};
	}
}

export async function executeQuery(
	sqlQuery,
	connectionString,
	schema,
	aiConfig,
	onLog,
	abortSignal,
	parameters = [],
) {
	const redactDatabaseSecrets = value =>
		redactConnectionDetails(value, connectionString);
	const log = (message, options) =>
		onLog?.(redactDatabaseSecrets(message), options);
	const verboseLog = messageOrFactory => {
		if (!(aiConfig?.diagnostics ?? aiConfig?.verbose)) return;
		const message =
			typeof messageOrFactory === 'function'
				? messageOrFactory()
				: messageOrFactory;
		log(`[Verbose][Query] ${message}`, {verbose: true});
	};
	verboseLog(`Provider: ${aiConfig?.provider || 'unavailable'}`);
	verboseLog(`Model: ${aiConfig?.model || 'unavailable'}`);
	verboseLog(`Connection target: ${redactConnectionString(connectionString)}`);
	verboseLog(`Initial SQL:\n${sqlQuery}`);
	verboseLog(() => `Schema:\n${formatVerboseValue(schema)}`);
	const requiredParameters = new Set(String(sqlQuery).match(/\$\d+\b/g) || []);

	if (!isReadOnlyQuery(sqlQuery)) {
		verboseLog('Read-only validation rejected the initial SQL');
		return {
			error: 'Only SELECT queries are allowed',
			sql: sqlQuery,
			data: null,
		};
	}

	const maxRetries = 3;
	let currentSql = sqlQuery;
	let lastError = null;
	let aiClient = null;

	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		let conn;
		const attemptStartedAt = Date.now();
		try {
			throwIfAborted(abortSignal, 'Query execution cancelled');
			verboseLog(`Starting attempt ${attempt}/${maxRetries}`);

			if (attempt > 1) {
				if (!aiConfig?.available) {
					return {
						error: `Query failed: ${lastError}. Automatic repair unavailable: ${aiConfig?.unavailableMessage || 'AI provider is unavailable'}`,
						sql: currentSql,
						data: null,
					};
				}

				log(`Attempt ${attempt}/${maxRetries}: Fixing SQL...`);
				try {
					aiClient ||= createAIClient(aiConfig, log);
				} catch (error) {
					return {
						error: `Query failed: ${lastError}. Automatic repair unavailable: ${error.message}`,
						sql: currentSql,
						data: null,
					};
				}

				const result = await aiClient.fixSQL(
					currentSql,
					lastError,
					schema,
					abortSignal,
				);
				verboseLog(() => `SQL repair result:\n${formatVerboseValue(result)}`);
				if (result.error) {
					return {error: result.error, sql: currentSql, data: null};
				}

				currentSql = result.sql;
				verboseLog(`Repaired SQL:\n${currentSql}`);

				if (!isReadOnlyQuery(currentSql)) {
					return {
						error: 'Only SELECT queries are allowed',
						sql: currentSql,
						data: null,
					};
				}

				const repairedParameters = new Set(
					String(currentSql).match(/\$\d+\b/g) || [],
				);
				if (
					[...requiredParameters].some(
						parameter => !repairedParameters.has(parameter),
					)
				) {
					return {
						error: 'Repaired query must preserve all positional parameters',
						sql: currentSql,
						data: null,
					};
				}
			}

			conn = await createConnection(connectionString);
			verboseLog(`Database connection opened for attempt ${attempt}`);
			throwIfAborted(abortSignal, 'Query execution cancelled');

			log('Executing query...');
			verboseLog(`Executing SQL:\n${currentSql}`);
			const data = await conn.query(currentSql, {abortSignal, parameters});
			throwIfAborted(abortSignal, 'Query execution cancelled');
			const rows = [...data];
			log(`Query returned ${rows.length} rows`);
			verboseLog(
				`Attempt ${attempt} completed in ${Date.now() - attemptStartedAt}ms`,
			);
			verboseLog(
				`Result columns: ${rows.length > 0 ? Object.keys(rows[0]).join(', ') : '<none>'}`,
			);
			verboseLog(() => `Result data:\n${formatVerboseValue(rows)}`);
			await conn.close();
			verboseLog('Database connection closed');
			return {error: null, sql: currentSql, data: rows};
		} catch (error) {
			if (conn) {
				await conn.close().catch(() => {});
				verboseLog('Database connection closed after an error');
			}

			if (isAbortError(error)) {
				log('Query execution cancelled');
				return {cancelled: true, error: null, sql: currentSql, data: null};
			}

			if (!conn) {
				return {
					error: `Failed to connect: ${redactDatabaseSecrets(error.message)}`,
					sql: currentSql,
					data: null,
				};
			}

			lastError = redactDatabaseSecrets(error.message);
			log(`Query error: ${lastError}`);
			verboseLog(`Attempt exception:\n${error.stack || error.message}`);
			if (attempt === maxRetries) {
				return {
					error: `Query failed after ${maxRetries} attempts: ${lastError}`,
					sql: currentSql,
					data: null,
				};
			}
		}
	}

	return {error: 'Unexpected error', sql: currentSql, data: null};
}

function redactConnectionString(connectionString) {
	return String(connectionString).replace(
		/^((?:postgres(?:ql)?|mysql2?):\/\/)[^@]+@/i,
		'$1<credentials>@',
	);
}

function redactConnectionDetails(value, connectionString) {
	const output = String(value);
	const rawConnectionString = String(connectionString || '');
	if (!rawConnectionString) return output;

	return output
		.split(rawConnectionString)
		.join(redactConnectionString(rawConnectionString))
		.replace(
			/((?:postgres(?:ql)?|mysql2?):\/\/)[^@\s]+@/gi,
			'$1<credentials>@',
		);
}

function formatVerboseValue(value, maxLength = 20_000) {
	let output;
	try {
		output = JSON.stringify(
			value,
			(_key, item) => (typeof item === 'bigint' ? item.toString() : item),
			2,
		);
	} catch (error) {
		return `<unable to serialize: ${error.message}>`;
	}

	if (output === undefined) return String(value);
	if (output.length <= maxLength) return output;
	return `${output.slice(0, maxLength)}\n… truncated ${output.length - maxLength} characters`;
}
