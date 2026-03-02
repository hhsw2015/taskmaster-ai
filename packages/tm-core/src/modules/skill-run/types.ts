/**
 * @fileoverview Type definitions for Codex Skill long-horizon execution.
 */

import type { Task } from '../../common/types/index.js';

export interface SkillRunPaths {
	agentsPath: string;
	skillAgentsPath: string;
	skillPath: string;
	skillAssetsDir: string;
	sessionDir: string;
	specPath: string;
	progressPath: string;
	todoCsvPath: string;
	mapPath: string;
	checkpointPath: string;
	ledgerPath: string;
	logsDir: string;
}

export type AgentsHookMode = 'append' | 'skip' | 'fail';
export type SkillRunMode = 'lite' | 'full' | 'auto';

export interface SkillRunInitOptions {
	agentsPath?: string;
	agentsMode?: AgentsHookMode;
	mode?: SkillRunMode;
	skillPath?: string;
	sessionDir?: string;
}

export interface SkillRunInitResult {
	paths: SkillRunPaths;
	created: string[];
	updated: string[];
	skipped: string[];
}

export type LedgerStatus = 'IN_PROGRESS' | 'DONE' | 'FAILED' | 'BLOCKED';

export interface LedgerEntry {
	timestamp: string;
	taskId: string;
	title: string;
	attempt: number;
	status: LedgerStatus;
	exitCode: number | null;
	durationMs: number;
	logFile: string;
	notes?: string;
}

export interface CheckpointState {
	updatedAt: string;
	attempts: Record<string, number>;
	doneTaskIds: string[];
	blockedTaskIds: string[];
	lastTaskId?: string;
}

export interface TaskmasterMapRow {
	rowId: number;
	taskId: string;
	title: string;
	dependencies: string[];
}

export interface TaskmasterMap {
	generatedAt: string;
	rows: TaskmasterMapRow[];
}

export interface SkillRunCallbacks {
	onInfo?: (message: string) => void;
	onWarning?: (message: string) => void;
	onTaskStart?: (task: Task, attempt: number) => void;
	onTaskEnd?: (summary: {
		taskId: string;
		title: string;
		attempt: number;
		status: LedgerStatus;
		exitCode: number | null;
		durationMs: number;
		logFile: string;
	}) => void;
	onStdout?: (text: string) => void;
	onStderr?: (text: string) => void;
}

export interface SkillRunOptions extends SkillRunInitOptions {
	tag?: string;
	maxRetries?: number;
	executor?: string;
	model?: string;
	reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
	/** @deprecated Use execHardTimeoutMs; kept for compatibility */
	execTimeoutMs?: number;
	execIdleTimeoutMs?: number;
	execHardTimeoutMs?: number;
	terminateOnResult?: boolean;
	fullAuto?: boolean;
	skipGitRepoCheck?: boolean;
	maxTasks?: number;
	continueOnFailure?: boolean;
	callbacks?: SkillRunCallbacks;
}

export interface SkillRunResult {
	completedTaskIds: string[];
	blockedTaskIds: string[];
	attempts: Record<string, number>;
	totalRuns: number;
	finalStatus: 'all_complete' | 'partial' | 'error';
	errorMessage?: string;
}
