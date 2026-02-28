/**
 * @fileoverview Constants for Task Master Core
 * Single source of truth for all constant values
 */

import type {
	TaskComplexity,
	TaskPriority,
	TaskStatus
} from '../types/index.js';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_PACKAGE_NAME = 'task-master-ai';
const DEFAULT_VERSION = 'unknown';

function isTaskMasterCliPackageJson(content: unknown): content is {
	name?: unknown;
	version?: unknown;
	bin?: unknown;
} {
	if (!content || typeof content !== 'object') {
		return false;
	}

	const pkg = content as { bin?: unknown };
	if (!pkg.bin || typeof pkg.bin !== 'object') {
		return false;
	}

	const bin = pkg.bin as Record<string, unknown>;
	return (
		Object.prototype.hasOwnProperty.call(bin, 'task-master') ||
		Object.prototype.hasOwnProperty.call(bin, 'task-master-ai')
	);
}

function readJsonFile(filePath: string): unknown | null {
	try {
		const raw = fs.readFileSync(filePath, 'utf8');
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

function findTaskMasterCliPackageJson(startDir: string): string | null {
	let currentDir = startDir;

	while (true) {
		const candidate = path.join(currentDir, 'package.json');
		if (fs.existsSync(candidate)) {
			const content = readJsonFile(candidate);
			if (isTaskMasterCliPackageJson(content)) {
				return candidate;
			}
		}

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) {
			return null;
		}
		currentDir = parentDir;
	}
}

export function resolveTaskMasterPackageMetadata(
	startDir = path.dirname(fileURLToPath(import.meta.url))
): {
	name: string;
	version: string;
} {
	const packageJsonPath = findTaskMasterCliPackageJson(startDir);
	if (!packageJsonPath) {
		return {
			name: DEFAULT_PACKAGE_NAME,
			version: process.env.npm_package_version || DEFAULT_VERSION
		};
	}

	const content = readJsonFile(packageJsonPath);
	if (!content || typeof content !== 'object') {
		return {
			name: DEFAULT_PACKAGE_NAME,
			version: process.env.npm_package_version || DEFAULT_VERSION
		};
	}

	const packageJson = content as { name?: unknown; version?: unknown };
	const name =
		typeof packageJson.name === 'string' && packageJson.name.trim().length > 0
			? packageJson.name
			: DEFAULT_PACKAGE_NAME;
	const version =
		typeof packageJson.version === 'string' &&
		packageJson.version.trim().length > 0
			? packageJson.version
			: process.env.npm_package_version || DEFAULT_VERSION;

	return { name, version };
}

const taskMasterPackageMetadata = resolveTaskMasterPackageMetadata();

/**
 * Task Master version from root package.json
 * Centralized to avoid fragile relative paths throughout the codebase
 */
export const TASKMASTER_VERSION = taskMasterPackageMetadata.version;

/**
 * Package name from root package.json
 */
export const PACKAGE_NAME = taskMasterPackageMetadata.name;

/**
 * Valid task status values
 */
export const TASK_STATUSES: readonly TaskStatus[] = [
	'pending',
	'in-progress',
	'done',
	'deferred',
	'cancelled',
	'blocked',
	'review'
] as const;

/**
 * Terminal complete statuses - tasks that are finished and satisfy dependencies
 * These statuses indicate a task is in a final state and:
 * - Should count toward completion percentage
 * - Should be considered satisfied for dependency resolution
 * - Should not be selected as "next task"
 *
 * Note: 'completed' is a workflow-specific alias for 'done' used in some contexts
 */
export const TERMINAL_COMPLETE_STATUSES: readonly TaskStatus[] = [
	'done',
	'completed',
	'cancelled'
] as const;

/**
 * Check if a task status represents a terminal complete state
 *
 * @param status - The task status to check
 * @returns true if the status represents a completed/terminal task
 *
 * @example
 * ```typescript
 * isTaskComplete('done')      // true
 * isTaskComplete('completed') // true
 * isTaskComplete('cancelled') // true
 * isTaskComplete('pending')   // false
 * ```
 */
export function isTaskComplete(status: TaskStatus): boolean {
	return TERMINAL_COMPLETE_STATUSES.includes(status);
}

/**
 * Valid task priority values
 */
export const TASK_PRIORITIES: readonly TaskPriority[] = [
	'low',
	'medium',
	'high',
	'critical'
] as const;

/**
 * Valid task complexity values
 */
export const TASK_COMPLEXITIES: readonly TaskComplexity[] = [
	'simple',
	'moderate',
	'complex',
	'very-complex'
] as const;

/**
 * Valid output formats for task display
 */
export const OUTPUT_FORMATS = ['text', 'json', 'compact'] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

/**
 * Status icons for display
 */
export const STATUS_ICONS: Record<TaskStatus, string> = {
	done: '✓',
	completed: '✓',
	'in-progress': '►',
	blocked: '⭕',
	pending: '○',
	deferred: '⏸',
	cancelled: '✗',
	review: '👁'
} as const;

/**
 * Status colors for display (using chalk color names)
 */
export const STATUS_COLORS: Record<TaskStatus, string> = {
	pending: 'yellow',
	'in-progress': 'blue',
	done: 'green',
	deferred: 'gray',
	cancelled: 'red',
	blocked: 'magenta',
	review: 'cyan',
	completed: 'green'
} as const;

/**
 * Provider constants - AI model providers
 */
export * from './providers.js';

/**
 * Path constants - file paths and directory structure
 */
export * from './paths.js';
