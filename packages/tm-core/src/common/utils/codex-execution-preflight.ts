import { existsSync, readFileSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface CodexExecutionPreflightResult {
	success: boolean;
	errors: string[];
	projectRoot: string;
	configPath: string;
	trustLevel?: string;
	approvalPolicy?: string;
}

interface ParsedCodexConfig {
	rootValues: Map<string, string>;
	projectValues: Map<string, Map<string, string>>;
	profileValues: Map<string, Map<string, string>>;
}

type ParsedSection =
	| { type: 'root' }
	| { type: 'project'; projectPath: string }
	| { type: 'profile'; profileName: string }
	| { type: 'other' };

function defaultCodexConfigPath(): string {
	return path.join(os.homedir(), '.codex', 'config.toml');
}

function normalizePathForComparison(value: string): string {
	const resolved = path.resolve(value);
	let normalized = resolved;
	try {
		normalized = realpathSync(resolved);
	} catch {
		normalized = resolved;
	}

	if (process.platform === 'win32') {
		return normalized.toLowerCase();
	}
	return normalized;
}

function isSameOrAncestorPath(parentPath: string, childPath: string): boolean {
	if (parentPath === childPath) {
		return true;
	}

	if (parentPath === path.sep) {
		return childPath.startsWith(path.sep);
	}

	const prefix = parentPath.endsWith(path.sep)
		? parentPath
		: `${parentPath}${path.sep}`;
	return childPath.startsWith(prefix);
}

function stripInlineComment(value: string): string {
	let inSingleQuote = false;
	let inDoubleQuote = false;
	let escaped = false;
	let output = '';

	for (const char of value) {
		if (escaped) {
			output += char;
			escaped = false;
			continue;
		}

		if (char === '\\' && inDoubleQuote) {
			output += char;
			escaped = true;
			continue;
		}

		if (char === "'" && !inDoubleQuote) {
			inSingleQuote = !inSingleQuote;
			output += char;
			continue;
		}

		if (char === '"' && !inSingleQuote) {
			inDoubleQuote = !inDoubleQuote;
			output += char;
			continue;
		}

		if (char === '#' && !inSingleQuote && !inDoubleQuote) {
			break;
		}

		output += char;
	}

	return output.trim();
}

function unquoteTomlString(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length < 2) return trimmed;

	if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
		return trimmed.slice(1, -1);
	}

	if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
		try {
			return JSON.parse(trimmed);
		} catch {
			return trimmed.slice(1, -1);
		}
	}

	return trimmed;
}

function parseSectionHeader(rawSection: string): ParsedSection {
	const section = rawSection.trim();
	if (!section) return { type: 'other' };

	const projectMatch = section.match(/^projects\."((?:[^"\\]|\\.)+)"$/);
	if (projectMatch) {
		return {
			type: 'project',
			projectPath: unquoteTomlString(`"${projectMatch[1]}"`)
		};
	}

	const profileMatch = section.match(/^(?:profiles|profile)\.(.+)$/);
	if (profileMatch) {
		return {
			type: 'profile',
			profileName: unquoteTomlString(profileMatch[1])
		};
	}

	return { type: 'other' };
}

function getOrCreateStringMap(
	container: Map<string, Map<string, string>>,
	key: string
): Map<string, string> {
	const existing = container.get(key);
	if (existing) {
		return existing;
	}
	const created = new Map<string, string>();
	container.set(key, created);
	return created;
}

function parseCodexConfig(rawConfig: string): ParsedCodexConfig {
	const rootValues = new Map<string, string>();
	const projectValues = new Map<string, Map<string, string>>();
	const profileValues = new Map<string, Map<string, string>>();

	let currentSection: ParsedSection = { type: 'root' };

	for (const line of rawConfig.split('\n')) {
		const withoutComments = stripInlineComment(line);
		if (!withoutComments) continue;

		const sectionMatch = withoutComments.match(/^\[([^\]]+)\]$/);
		if (sectionMatch) {
			currentSection = parseSectionHeader(sectionMatch[1]);
			continue;
		}

		const keyValueMatch = withoutComments.match(
			/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/
		);
		if (!keyValueMatch) continue;

		const key = keyValueMatch[1];
		const value = unquoteTomlString(keyValueMatch[2]);

		if (currentSection.type === 'root') {
			rootValues.set(key, value);
			continue;
		}

		if (currentSection.type === 'project') {
			const map = getOrCreateStringMap(
				projectValues,
				currentSection.projectPath
			);
			map.set(key, value);
			continue;
		}

		if (currentSection.type === 'profile') {
			const map = getOrCreateStringMap(
				profileValues,
				currentSection.profileName
			);
			map.set(key, value);
		}
	}

	return { rootValues, projectValues, profileValues };
}

function getProjectTrustLevel(
	projectRoot: string,
	projectValues: Map<string, Map<string, string>>
): string | undefined {
	const normalizedProjectRoot = normalizePathForComparison(projectRoot);
	let bestMatchLength = -1;
	let trustLevel: string | undefined;

	for (const [configuredPath, values] of projectValues.entries()) {
		const normalizedConfiguredPath = normalizePathForComparison(configuredPath);
		if (
			!isSameOrAncestorPath(normalizedConfiguredPath, normalizedProjectRoot)
		) {
			continue;
		}

		if (normalizedConfiguredPath.length <= bestMatchLength) {
			continue;
		}

		bestMatchLength = normalizedConfiguredPath.length;
		trustLevel = values.get('trust_level');
	}

	return trustLevel?.toLowerCase();
}

function getApprovalPolicy(
	rootValues: Map<string, string>,
	profileValues: Map<string, Map<string, string>>,
	explicitProfile?: string
): string | undefined {
	const activeProfile =
		explicitProfile ||
		rootValues.get('profile') ||
		rootValues.get('default_profile');

	if (activeProfile) {
		const values = profileValues.get(activeProfile);
		const profilePolicy =
			values?.get('ask_for_approval') || values?.get('approval_policy');
		if (profilePolicy) {
			return profilePolicy.toLowerCase();
		}
	}

	const rootPolicy =
		rootValues.get('ask_for_approval') || rootValues.get('approval_policy');
	return rootPolicy?.toLowerCase();
}

function buildTrustError(projectRoot: string, trustLevel?: string): string {
	if (!trustLevel) {
		return `Project "${projectRoot}" is not trusted in Codex config. Add [projects."${projectRoot}"] with trust_level = "trusted".`;
	}

	return `Project "${projectRoot}" trust_level is "${trustLevel}". Set trust_level = "trusted".`;
}

function buildApprovalError(policy?: string): string {
	if (!policy) {
		return 'Codex approval policy is not configured for unattended execution. Set ask_for_approval = "never" (or approval_policy = "never").';
	}

	return `Codex approval policy is "${policy}". Set ask_for_approval = "never" (or approval_policy = "never").`;
}

export function runCodexExecutionPreflight(
	projectRoot: string,
	options?: { configPath?: string; profile?: string }
): CodexExecutionPreflightResult {
	const normalizedProjectRoot = normalizePathForComparison(projectRoot);
	const configPath = options?.configPath || defaultCodexConfigPath();
	const errors: string[] = [];

	if (!existsSync(configPath)) {
		return {
			success: false,
			errors: [
				`Codex config file not found at "${configPath}". Run "codex login" and configure trust/approval first.`
			],
			projectRoot: normalizedProjectRoot,
			configPath
		};
	}

	const rawConfig = readFileSync(configPath, 'utf-8');
	const parsed = parseCodexConfig(rawConfig);

	const trustLevel = getProjectTrustLevel(
		normalizedProjectRoot,
		parsed.projectValues
	);
	if (trustLevel !== 'trusted') {
		errors.push(buildTrustError(normalizedProjectRoot, trustLevel));
	}

	const approvalPolicy = getApprovalPolicy(
		parsed.rootValues,
		parsed.profileValues,
		options?.profile || process.env.CODEX_PROFILE
	);
	if (approvalPolicy !== 'never') {
		errors.push(buildApprovalError(approvalPolicy));
	}

	return {
		success: errors.length === 0,
		errors,
		projectRoot: normalizedProjectRoot,
		configPath,
		trustLevel,
		approvalPolicy
	};
}
