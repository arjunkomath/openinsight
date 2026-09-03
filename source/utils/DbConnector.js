import {SQL} from 'bun';
import {createAbortError, isAbortError, throwIfAborted} from './abort.js';

const CONNECTION_SCHEMES = [
	{
		prefixes: ['sqlite://', 'file://'],
		protocol: 'sqlite',
	},
	{
		prefixes: ['mysql://', 'mysql2://'],
		protocol: 'mysql',
		pattern: /^mysql2?:\/\/([^:]+):([^@]+)@([^:/]+)(?::(\d+))?\/(.+)$/i,
		error: 'Invalid MySQL connection string format',
	},
	{
		prefixes: ['postgres://', 'postgresql://'],
		protocol: 'postgres',
		pattern:
			/^(?:postgres|postgresql):\/\/([^:]+):([^@]+)@([^:/]+)(?::(\d+))?\/(.+)$/i,
		error: 'Invalid PostgreSQL connection string format',
	},
];

export function validateConnectionString(connectionString) {
	if (!connectionString || typeof connectionString !== 'string') {
		return {isValid: false, error: 'Connection string is required'};
	}

	for (const scheme of CONNECTION_SCHEMES) {
		if (!scheme.prefixes.some(prefix => connectionString.startsWith(prefix))) {
			continue;
		}

		if (scheme.pattern && !scheme.pattern.test(connectionString)) {
			return {isValid: false, error: scheme.error};
		}

		return {isValid: true, protocol: scheme.protocol};
	}

	return {
		isValid: false,
		error: 'Unsupported database type. Use postgres://, mysql://, or sqlite://',
	};
}

function translateAbortError(error, abortSignal, message) {
	if (abortSignal?.aborted || isAbortError(error)) {
		return createAbortError(message);
	}

	return error;
}

export function prepareDriverQuery(sql, parameters, protocol) {
	if (protocol !== 'mysql' || parameters.length === 0) {
		return {sql, parameters};
	}

	const boundParameters = [];
	let translated = false;
	const driverSql = sql.replace(/\$(\d+)\b/g, (placeholder, value) => {
		const index = Number(value) - 1;
		if (index < 0 || index >= parameters.length) {
			throw new Error(`No value supplied for parameter ${placeholder}`);
		}

		translated = true;
		boundParameters.push(parameters[index]);
		return '?';
	});

	return translated
		? {sql: driverSql, parameters: boundParameters}
		: {sql, parameters};
}

class SqlConnection {
	constructor(connectionString, protocol) {
		this.connectionString = connectionString;
		this.protocol = protocol;
		this.client = null;
	}

	#getClient() {
		if (!this.client) {
			this.client = new SQL(this.connectionString);
		}

		return this.client;
	}

	async query(sql, {abortSignal, parameters = []} = {}) {
		throwIfAborted(abortSignal, 'Query execution cancelled');

		const driverQuery = prepareDriverQuery(sql, parameters, this.protocol);
		const useEphemeralClient =
			this.protocol === 'mysql' && Boolean(abortSignal);
		const client = useEphemeralClient
			? new SQL(this.connectionString)
			: this.#getClient();

		const query = client
			.unsafe(driverQuery.sql, driverQuery.parameters)
			.execute();

		const onAbort = () => {
			try {
				query.cancel();
			} catch {
				/* best-effort cancel */
			}

			if (useEphemeralClient) {
				try {
					client.close({timeout: 0});
				} catch {
					/* best-effort force-close */
				}
			}
		};

		abortSignal?.addEventListener('abort', onAbort, {once: true});

		try {
			const rows = await query;
			throwIfAborted(abortSignal, 'Query execution cancelled');
			return [...rows];
		} catch (error) {
			throw translateAbortError(
				error,
				abortSignal,
				'Query execution cancelled',
			);
		} finally {
			abortSignal?.removeEventListener('abort', onAbort);

			if (useEphemeralClient) {
				await client.close().catch(() => {});
			}
		}
	}

	async close() {
		if (!this.client) {
			return;
		}

		const client = this.client;
		this.client = null;
		await client.close();
	}
}

export async function testConnection(connectionString) {
	const validation = validateConnectionString(connectionString);
	if (!validation.isValid) {
		return {success: false, error: validation.error};
	}

	let client;

	try {
		client = new SQL(connectionString);
		await client.unsafe('SELECT 1').execute();
		return {success: true};
	} catch (error) {
		return {
			success: false,
			error: error.message || 'Failed to connect to database',
		};
	} finally {
		await client?.close().catch(() => {});
	}
}

export async function createConnection(connectionString) {
	const validation = validateConnectionString(connectionString);
	if (!validation.isValid) {
		throw new Error(validation.error);
	}

	return new SqlConnection(connectionString, validation.protocol);
}
