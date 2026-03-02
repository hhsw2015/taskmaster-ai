/**
 * @fileoverview Long-horizon runner that combines Taskmaster task graph with Codex Skill assets.
 */

import { createWriteStream, existsSync } from 'node:fs';
import {
	appendFile,
	mkdir,
	readFile,
	stat,
	writeFile
} from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { Task, TaskStatus } from '../../../common/types/index.js';
import type { TasksDomain } from '../../tasks/tasks-domain.js';
import type {
	AgentsHookMode,
	CheckpointState,
	LedgerEntry,
	SkillRunMode,
	SkillRunInitOptions,
	SkillRunInitResult,
	SkillRunOptions,
	SkillRunPaths,
	SkillRunResult,
	TaskmasterMap,
	TaskmasterMapRow
} from '../types.js';

const AGENTS_MARK_START = '<!-- TM-LONGRUN-START -->';
const AGENTS_MARK_END = '<!-- TM-LONGRUN-END -->';
const MAX_RETRIES_DEFAULT = 3;
const EXEC_IDLE_TIMEOUT_MS_DEFAULT = 20 * 60 * 1000;
const FORCE_KILL_GRACE_MS = 5000;
const RESULT_TERMINATE_GRACE_MS = 1500;
const RESULT_PREFIX = 'TM_RESULT:';
const OUTPUT_BUFFER_MAX_CHARS = 200_000;

const SKILL_FRONTMATTER = `---
name: taskmaster-longrun
description: Execute one Taskmaster task per Codex run with checkpoint and ledger discipline.
---`;

const DEFAULT_SKILL_BODY = `# Taskmaster Longrun Skill

## Goal
Use Taskmaster as the source of truth and execute one task at a time with Codex CLI.

## Rules
1. Task structure/dependencies come from Taskmaster only.
2. CSV is runtime ledger, not task source.
3. Execute only current task; do not auto-pick next inside one Codex call.
4. Return concise implementation summary and test evidence.
`;

const DEFAULT_SKILL_TEMPLATE = `${SKILL_FRONTMATTER}\n\n${DEFAULT_SKILL_BODY}`;

const DEFAULT_PROGRESS_TEMPLATE = `# PROGRESS

Decision log and audit trail for this longrun session.

## Entries
`;

const UPSTREAM_TASKMASTER_SKILL_URL =
	'https://raw.githubusercontent.com/lili-luo/aicoding-cookbook/refs/heads/main/skills/codex/taskmaster/SKILL.md';
const UPSTREAM_CODEX_AGENTS_URL =
	'https://raw.githubusercontent.com/lili-luo/aicoding-cookbook/refs/heads/main/skills/codex/AGENTS.md';

const FALLBACK_UPSTREAM_AGENTS = `# Global Agent Rules

## Language

Default to Chinese in user-facing replies unless the user explicitly requests another language.
`;

const SKILL_INTEGRATION_MARK_START = '<!-- TM-INTEGRATION-START -->';
const SKILL_INTEGRATION_MARK_END = '<!-- TM-INTEGRATION-END -->';
const SKILL_INTEGRATION_ADDENDUM = `${SKILL_INTEGRATION_MARK_START}
## Taskmaster Integration Addendum

This addendum defines how this upstream skill is integrated with Task Master CLI:

1. Task source of truth is Taskmaster tasks data.
2. Execute exactly one Taskmaster task per \`codex exec\` run.
3. Load order for prompt context:
   - project AGENTS.md/agent.md
   - .codex/skills/taskmaster-longrun/AGENTS.md
   - .codex/skills/taskmaster-longrun/SKILL.md
4. Runtime artifacts are managed by the runner:
   - LITE mode: project-root TODO.csv
   - FULL mode: .codex-tasks/taskmaster-longrun/{SPEC.md,TODO.csv,PROGRESS.md}
5. Model output may update CSV/PROGRESS artifacts, but must not mutate Taskmaster status.
6. Runner is the only status writer and parses machine-readable result:
   - success => done
   - retry exhausted => blocked
${SKILL_INTEGRATION_MARK_END}`;

function nowIso(): string {
	return new Date().toISOString();
}

function ensurePosix(relativePath: string): string {
	return relativePath.split(path.sep).join('/');
}

function safeTaskId(taskId: string): string {
	return taskId.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function toCsvCell(value: string): string {
	const normalized = value.replace(/\r?\n/g, ' ').trim();
	if (/[",]/.test(normalized)) {
		return `"${normalized.replace(/"/g, '""')}"`;
	}
	return normalized;
}

interface CsvRow {
	taskId: string;
	title: string;
	status: 'TODO' | 'IN_PROGRESS' | 'DONE' | 'FAILED';
	acceptanceCriteria: string;
	validationCommand: string;
	completedAt: string;
	retryCount: number;
	notes: string;
	dependencies: string[];
}

interface ParsedTaskResult {
	status: 'done' | 'failed';
	validation: 'pass' | 'fail' | 'unknown';
	summary: string;
	raw: string;
}

interface CodexExecResult {
	exitCode: number | null;
	signal: NodeJS.Signals | null;
	durationMs: number;
	logFile: string;
	timedOut: boolean;
	timeoutMs: number | null;
	timeoutKind: 'idle' | 'hard' | null;
	parsedResult: ParsedTaskResult | null;
}

interface ExecutionOutcome {
	success: boolean;
	note?: string;
}

export class SkillRunService {
	constructor(
		private readonly projectRoot: string,
		private readonly tasksDomain: TasksDomain
	) {}

	resolvePaths(options: SkillRunInitOptions = {}): SkillRunPaths {
		const mode = this.resolveMode(options.mode);
		const sessionDir = options.sessionDir
			? path.resolve(this.projectRoot, options.sessionDir)
			: path.join(this.projectRoot, '.codex-tasks', 'taskmaster-longrun');
		const agentsPath = options.agentsPath
			? path.resolve(this.projectRoot, options.agentsPath)
			: this.resolveDefaultAgentsPath();
		const skillPath = options.skillPath
			? path.resolve(this.projectRoot, options.skillPath)
			: path.join(
				this.projectRoot,
				'.codex',
				'skills',
				'taskmaster-longrun',
				'SKILL.md'
			);
		const skillAgentsPath = path.join(path.dirname(skillPath), 'AGENTS.md');
		return {
			agentsPath,
			skillAgentsPath,
			skillPath,
			sessionDir,
			specPath: path.join(sessionDir, 'SPEC.md'),
			progressPath: path.join(sessionDir, 'PROGRESS.md'),
			todoCsvPath:
				mode === 'lite'
					? path.join(this.projectRoot, 'TODO.csv')
					: path.join(sessionDir, 'TODO.csv'),
			mapPath: path.join(sessionDir, 'taskmaster-map.json'),
			checkpointPath: path.join(sessionDir, 'checkpoint.json'),
			ledgerPath: path.join(sessionDir, 'ledger.jsonl'),
			logsDir: path.join(sessionDir, 'logs')
		};
	}

	async initAssets(options: SkillRunInitOptions = {}): Promise<SkillRunInitResult> {
		const paths = this.resolvePaths(options);
		const mode = this.resolveMode(options.mode);
		await mkdir(path.dirname(paths.skillPath), { recursive: true });
		await mkdir(paths.sessionDir, { recursive: true });
		await mkdir(paths.logsDir, { recursive: true });
		await this.ensureCodexTasksGitignore();

		const result: SkillRunInitResult = {
			paths,
			created: [],
			updated: [],
			skipped: []
		};

		await this.ensureAgentsHook(
			paths.agentsPath,
			result,
			options.agentsMode ?? 'append'
		);
		await this.ensureUpstreamAgentsTemplate(paths.skillAgentsPath, result);
		await this.ensureSkillTemplate(paths.skillPath, result);
		if (mode === 'full') {
			await this.ensureSpecTemplate(paths.specPath, result);
			await this.ensureProgressTemplate(paths.progressPath, result);
		}
		return result;
	}

	async run(options: SkillRunOptions = {}): Promise<SkillRunResult> {
		const callbacks = options.callbacks;
		const mode = this.resolveMode(options.mode);
		const initResult = await this.initAssets({ ...options, mode });
		const paths = initResult.paths;
		const checkpoint = await this.loadCheckpoint(paths.checkpointPath);
		const maxRetries = Math.max(0, options.maxRetries ?? MAX_RETRIES_DEFAULT);
		let totalRuns = 0;

		await this.syncTodoAndMap(options.tag, checkpoint, paths, mode);

		while (true) {
			const nextTask = await this.tasksDomain.getNext(options.tag);
			if (!nextTask) {
				break;
			}
			if (options.maxTasks && totalRuns >= options.maxTasks) {
				break;
			}

			const taskId = String(nextTask.id);
			const attempt = (checkpoint.attempts[taskId] ?? 0) + 1;
			checkpoint.attempts[taskId] = attempt;
			checkpoint.lastTaskId = taskId;
			await this.tasksDomain.updateStatus(taskId, 'in-progress', options.tag);
			callbacks?.onTaskStart?.(nextTask, attempt);

			const execResult = await this.executeCodex(nextTask, attempt, paths, options);
			totalRuns++;
			const outcome = this.resolveExecutionOutcome(execResult);

			if (outcome.success) {
				await this.tasksDomain.updateStatus(taskId, 'done', options.tag);
				checkpoint.doneTaskIds = this.pushUnique(checkpoint.doneTaskIds, taskId);
				checkpoint.blockedTaskIds = checkpoint.blockedTaskIds.filter((id) => id !== taskId);
				await this.appendLedger(paths.ledgerPath, {
					timestamp: nowIso(),
					taskId,
					title: nextTask.title,
					attempt,
					status: 'DONE',
					exitCode: execResult.exitCode,
					durationMs: execResult.durationMs,
					logFile: execResult.logFile,
					notes: outcome.note
				});
				callbacks?.onTaskEnd?.({
					taskId,
					title: nextTask.title,
					attempt,
					status: 'DONE',
					exitCode: execResult.exitCode,
					durationMs: execResult.durationMs,
					logFile: execResult.logFile
				});
			} else {
				const reachedLimit = attempt > maxRetries;
				if (reachedLimit) {
					await this.tasksDomain.updateStatus(taskId, 'blocked', options.tag);
					checkpoint.blockedTaskIds = this.pushUnique(checkpoint.blockedTaskIds, taskId);
				} else {
					await this.tasksDomain.updateStatus(taskId, 'pending', options.tag);
				}
				const retryNote = reachedLimit
					? `max retries reached: ${maxRetries}`
					: 'will retry';
				await this.appendLedger(paths.ledgerPath, {
					timestamp: nowIso(),
					taskId,
					title: nextTask.title,
					attempt,
					status: reachedLimit ? 'BLOCKED' : 'FAILED',
					exitCode: execResult.exitCode,
					durationMs: execResult.durationMs,
					logFile: execResult.logFile,
					notes: this.combineNotes(outcome.note, retryNote)
				});
				callbacks?.onTaskEnd?.({
					taskId,
					title: nextTask.title,
					attempt,
					status: reachedLimit ? 'BLOCKED' : 'FAILED',
					exitCode: execResult.exitCode,
					durationMs: execResult.durationMs,
					logFile: execResult.logFile
				});
				if (!options.continueOnFailure) {
					await this.saveCheckpoint(paths.checkpointPath, checkpoint);
					await this.syncTodoAndMap(options.tag, checkpoint, paths, mode);
					return {
						completedTaskIds: checkpoint.doneTaskIds,
						blockedTaskIds: checkpoint.blockedTaskIds,
						attempts: checkpoint.attempts,
						totalRuns,
						finalStatus: 'error',
						errorMessage: `Task ${taskId} failed and continueOnFailure=false`
					};
				}
			}

			await this.saveCheckpoint(paths.checkpointPath, checkpoint);
			await this.syncTodoAndMap(options.tag, checkpoint, paths, mode);
		}

		await this.saveCheckpoint(paths.checkpointPath, checkpoint);
		await this.syncTodoAndMap(options.tag, checkpoint, paths, mode);
		return {
			completedTaskIds: checkpoint.doneTaskIds,
			blockedTaskIds: checkpoint.blockedTaskIds,
			attempts: checkpoint.attempts,
			totalRuns,
			finalStatus: checkpoint.blockedTaskIds.length > 0 ? 'partial' : 'all_complete'
		};
	}

	private async executeCodex(
		task: Task,
		attempt: number,
		paths: SkillRunPaths,
		options: SkillRunOptions
	): Promise<CodexExecResult> {
		const prompt = this.composePrompt(task, paths);
		const command = options.executor || 'codex';
		const args = this.buildExecutorArgs(prompt, options);
		const logFile = path.join(paths.logsDir, `${safeTaskId(String(task.id))}-attempt-${attempt}.log`);
		const start = Date.now();
		const idleTimeoutMs = this.resolveTimeoutMs(
			options.execIdleTimeoutMs,
			EXEC_IDLE_TIMEOUT_MS_DEFAULT
		);
		const hardTimeoutMs = this.resolveTimeoutMs(
			options.execHardTimeoutMs ?? options.execTimeoutMs,
			null
		);

		return new Promise((resolve) => {
			const out = createWriteStream(logFile, { flags: 'a' });
			const child = spawn(command, args, {
				cwd: this.projectRoot,
				stdio: ['ignore', 'pipe', 'pipe']
			});
			let timedOut = false;
			let timeoutKind: 'idle' | 'hard' | null = null;
			let timeoutMs: number | null = null;
			let outputBuffer = '';
			let parsedResult: ParsedTaskResult | null = null;
			let closeTimer: NodeJS.Timeout | null = null;
			let idleTimer: NodeJS.Timeout | null = null;
			let hardTimer: NodeJS.Timeout | null = null;

			const terminateChild = (reason: string): void => {
				if (child.killed || child.exitCode !== null || child.signalCode) {
					return;
				}
				out.write(`\n[runner-${reason}] terminating executor process\n`);
				child.kill('SIGTERM');
				closeTimer = setTimeout(() => {
					if (child.killed || child.exitCode !== null || child.signalCode) {
						return;
					}
					out.write('\n[runner-force-kill] process did not exit after SIGTERM\n');
					child.kill('SIGKILL');
				}, FORCE_KILL_GRACE_MS);
			};

			const markTimeoutAndTerminate = (kind: 'idle' | 'hard', ms: number): void => {
				timedOut = true;
				timeoutKind = kind;
				timeoutMs = ms;
				options.callbacks?.onWarning?.(
					`Executor ${kind} timeout after ${ms}ms for task ${task.id}`
				);
				terminateChild(`${kind}-timeout`);
			};

			const resetIdleTimer = (): void => {
				if (!idleTimeoutMs) {
					return;
				}
				if (idleTimer) {
					clearTimeout(idleTimer);
				}
				idleTimer = setTimeout(() => {
					markTimeoutAndTerminate('idle', idleTimeoutMs);
				}, idleTimeoutMs);
			};

			resetIdleTimer();
			if (hardTimeoutMs) {
				hardTimer = setTimeout(() => {
					markTimeoutAndTerminate('hard', hardTimeoutMs);
				}, hardTimeoutMs);
			}

			const handleOutput = (text: string): void => {
				resetIdleTimer();
				outputBuffer = this.appendOutputBuffer(outputBuffer, text);
				if (parsedResult) {
					return;
				}
				const detected = this.extractTaskResult(outputBuffer);
				if (!detected) {
					return;
				}
				parsedResult = detected;
				options.callbacks?.onInfo?.(
					`Parsed ${RESULT_PREFIX} status=${detected.status} validation=${detected.validation}`
				);
				out.write(
					`\n[runner-result-detected] status=${detected.status} validation=${detected.validation}\n`
				);
				if (options.terminateOnResult ?? true) {
					setTimeout(() => {
						terminateChild('result-received');
					}, RESULT_TERMINATE_GRACE_MS);
				}
			};

			child.stdout?.on('data', (buf: Buffer) => {
				const text = buf.toString('utf-8');
				process.stdout.write(text);
				options.callbacks?.onStdout?.(text);
				out.write(text);
				handleOutput(text);
			});
			child.stderr?.on('data', (buf: Buffer) => {
				const text = buf.toString('utf-8');
				process.stderr.write(text);
				options.callbacks?.onStderr?.(text);
				out.write(text);
				handleOutput(text);
			});
			child.on('error', (error: Error) => {
				out.write(`\n[executor-error] ${error.message}\n`);
			});
			child.on('close', (exitCode, signal) => {
				if (idleTimer) {
					clearTimeout(idleTimer);
				}
				if (hardTimer) {
					clearTimeout(hardTimer);
				}
				if (closeTimer) {
					clearTimeout(closeTimer);
				}
				out.end();
				resolve({
					exitCode,
					signal,
					durationMs: Date.now() - start,
					logFile,
					timedOut,
					timeoutMs,
					timeoutKind,
					parsedResult
				});
			});
		});
	}

	private buildExecutorArgs(prompt: string, options: SkillRunOptions): string[] {
		const args = ['exec'];
		if (options.fullAuto ?? true) {
			args.push('--full-auto');
		}
		if (options.skipGitRepoCheck ?? true) {
			args.push('--skip-git-repo-check');
		}
		if (options.model) {
			args.push('-m', options.model);
		}
		if (options.reasoningEffort) {
			args.push('--config', `model_reasoning_effort=\"${options.reasoningEffort}\"`);
		}
		args.push(prompt);
		return args;
	}

	private resolveExecutionOutcome(execResult: CodexExecResult): ExecutionOutcome {
		if (execResult.parsedResult) {
			const parsed = execResult.parsedResult;
			if (parsed.status === 'done' && parsed.validation !== 'fail') {
				return {
					success: true,
					note: this.combineNotes(
						`parsed_result status=${parsed.status} validation=${parsed.validation}`,
						parsed.summary ? `summary: ${parsed.summary}` : undefined
					)
				};
			}
			return {
				success: false,
				note: this.combineNotes(
					`parsed_result status=${parsed.status} validation=${parsed.validation}`,
					parsed.summary ? `summary: ${parsed.summary}` : undefined
				)
			};
		}
		if (execResult.timedOut) {
			const kind = execResult.timeoutKind || 'unknown';
			const msText =
				typeof execResult.timeoutMs === 'number'
					? `${execResult.timeoutMs}ms`
					: 'unknown duration';
			return {
				success: false,
				note: `executor ${kind} timeout after ${msText}`
			};
		}
		if (execResult.exitCode === 0) {
			return {
				success: true,
				note: 'exit_code_fallback success (missing TM_RESULT)'
			};
		}
		return {
			success: false,
			note: `executor failed exitCode=${String(execResult.exitCode)} signal=${String(execResult.signal)}`
		};
	}

	private combineNotes(...notes: Array<string | undefined>): string | undefined {
		const merged = notes
			.map((note) => note?.trim())
			.filter((note): note is string => Boolean(note));
		if (merged.length === 0) {
			return undefined;
		}
		return merged.join(' | ');
	}

	private appendOutputBuffer(current: string, chunk: string): string {
		const next = `${current}${chunk}`;
		if (next.length <= OUTPUT_BUFFER_MAX_CHARS) {
			return next;
		}
		return next.slice(-OUTPUT_BUFFER_MAX_CHARS);
	}

	private resolveTimeoutMs(
		value: number | undefined,
		defaultValue: number | null
	): number | null {
		if (typeof value === 'number' && Number.isFinite(value)) {
			if (value <= 0) {
				return null;
			}
			return Math.max(1000, Math.trunc(value));
		}
		return defaultValue;
	}

	private extractTaskResult(output: string): ParsedTaskResult | null {
		const lines = output.split(/\r?\n/);
		for (let idx = lines.length - 1; idx >= 0; idx--) {
			const line = lines[idx];
			const prefixIndex = line.indexOf(RESULT_PREFIX);
			if (prefixIndex === -1) {
				continue;
			}
			const payload = line.slice(prefixIndex + RESULT_PREFIX.length).trim();
			const jsonStart = payload.indexOf('{');
			const jsonEnd = payload.lastIndexOf('}');
			if (jsonStart === -1 || jsonEnd === -1 || jsonEnd < jsonStart) {
				continue;
			}
			const rawJson = payload.slice(jsonStart, jsonEnd + 1);
			try {
				const parsed = JSON.parse(rawJson) as {
					status?: string;
					validation?: string;
					summary?: string;
				};
				const status = parsed.status?.toLowerCase();
				if (status !== 'done' && status !== 'failed') {
					continue;
				}
				const validation = parsed.validation?.toLowerCase();
				const normalizedValidation =
					validation === 'pass' || validation === 'fail' || validation === 'unknown'
						? validation
						: 'unknown';
				return {
					status,
					validation: normalizedValidation,
					summary:
						typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
					raw: rawJson
				};
			} catch {
				continue;
			}
		}
		return null;
	}

	private composePrompt(task: Task, paths: SkillRunPaths): string {
		const relAgents = ensurePosix(path.relative(this.projectRoot, paths.agentsPath));
		const relSkillAgents = ensurePosix(path.relative(this.projectRoot, paths.skillAgentsPath));
		const relSkill = ensurePosix(path.relative(this.projectRoot, paths.skillPath));
		const deps = task.dependencies?.length ? task.dependencies.join(', ') : 'none';
		return `@${relAgents}\n@${relSkillAgents}\n@${relSkill}

请只实现当前 Taskmaster 任务，不要继续下一个任务。

执行约束：
1) 可以按 Skill 维护 CSV/PROGRESS 产物，但不要调用 task-master-local 的状态更新能力（例如 set-status / update-task）。
2) 任务完成后必须输出一行机器可解析结果（单行 JSON）：
${RESULT_PREFIX} {"status":"done|failed","validation":"pass|fail|unknown","summary":"<简短总结>"}
3) 输出 ${RESULT_PREFIX} 行后立即结束，不要继续执行其他任务。

任务ID: ${task.id}
标题: ${task.title}
描述: ${task.description || ''}
实现细节: ${task.details || ''}
测试策略: ${task.testStrategy || ''}
依赖: ${deps}`;
	}

	private async ensureAgentsHook(
		filePath: string,
		result: SkillRunInitResult,
		mode: AgentsHookMode
	): Promise<void> {
		const block = `${AGENTS_MARK_START}\n## Taskmaster Longrun Hook\nWhen implementation starts, load AGENTS first, then load @.codex/skills/taskmaster-longrun/SKILL.md, then execute one Taskmaster task per Codex run.\n${AGENTS_MARK_END}`;
		if (!(await this.fileExists(filePath))) {
			await writeFile(filePath, `${block}\n`, 'utf-8');
			result.created.push(path.relative(this.projectRoot, filePath));
			return;
		}
		const content = await readFile(filePath, 'utf-8');
		const hasStart = content.includes(AGENTS_MARK_START);
		const hasEnd = content.includes(AGENTS_MARK_END);
		if (hasStart && hasEnd) {
			result.skipped.push(path.relative(this.projectRoot, filePath));
			return;
		}
		if (hasStart !== hasEnd) {
			throw new Error(
				`Invalid AGENTS hook markers in ${path.relative(this.projectRoot, filePath)}`
			);
		}
		if (mode === 'skip') {
			result.skipped.push(path.relative(this.projectRoot, filePath));
			return;
		}
		if (mode === 'fail') {
			throw new Error(
				`AGENTS hook missing in ${path.relative(this.projectRoot, filePath)}. Re-run with agentsMode=append to auto-insert.`
			);
		}
		await writeFile(filePath, `${content.trimEnd()}\n\n${block}\n`, 'utf-8');
		result.updated.push(path.relative(this.projectRoot, filePath));
	}

	private async ensureSkillTemplate(filePath: string, result: SkillRunInitResult): Promise<void> {
		const existing = await this.safeRead(filePath);
		if (!existing) {
			const remote = await this.loadRemoteTemplate(
				UPSTREAM_TASKMASTER_SKILL_URL,
				DEFAULT_SKILL_TEMPLATE
			);
			await writeFile(filePath, this.mergeSkillWithIntegrationAddon(remote), 'utf-8');
			result.created.push(path.relative(this.projectRoot, filePath));
			return;
		}
		if (
			this.looksLikeUpstreamTaskmasterSkill(existing) &&
			this.hasSkillIntegrationAddon(existing)
		) {
			result.skipped.push(path.relative(this.projectRoot, filePath));
			return;
		}
		const remote = await this.loadRemoteTemplate(
			UPSTREAM_TASKMASTER_SKILL_URL,
			DEFAULT_SKILL_TEMPLATE
		);
		await writeFile(filePath, this.mergeSkillWithIntegrationAddon(remote), 'utf-8');
		result.updated.push(path.relative(this.projectRoot, filePath));
	}

	private async ensureUpstreamAgentsTemplate(
		filePath: string,
		result: SkillRunInitResult
	): Promise<void> {
		const existing = await this.safeRead(filePath);
		if (existing && this.looksLikeUpstreamAgents(existing)) {
			result.skipped.push(path.relative(this.projectRoot, filePath));
			return;
		}
		const remote = await this.loadRemoteTemplate(
			UPSTREAM_CODEX_AGENTS_URL,
			FALLBACK_UPSTREAM_AGENTS
		);
		await writeFile(filePath, remote, 'utf-8');
		if (existing) {
			result.updated.push(path.relative(this.projectRoot, filePath));
		} else {
			result.created.push(path.relative(this.projectRoot, filePath));
		}
	}

	private async ensureSpecTemplate(filePath: string, result: SkillRunInitResult): Promise<void> {
		if (await this.fileExists(filePath)) {
			result.skipped.push(path.relative(this.projectRoot, filePath));
			return;
		}
		await writeFile(
			filePath,
			'# SPEC\n\nFrozen goal for this longrun session. It will be refreshed from Taskmaster tasks when run starts.\n',
			'utf-8'
		);
		result.created.push(path.relative(this.projectRoot, filePath));
	}

	private async ensureProgressTemplate(
		filePath: string,
		result: SkillRunInitResult
	): Promise<void> {
		if (await this.fileExists(filePath)) {
			result.skipped.push(path.relative(this.projectRoot, filePath));
			return;
		}
		await writeFile(filePath, DEFAULT_PROGRESS_TEMPLATE, 'utf-8');
		result.created.push(path.relative(this.projectRoot, filePath));
	}

	private hasYamlFrontmatter(content: string): boolean {
		return /^---\s*\n[\s\S]*?\n---\s*\n?/.test(content);
	}

	private looksLikeUpstreamTaskmasterSkill(content: string): boolean {
		return (
			this.hasYamlFrontmatter(content) &&
			content.includes('name: taskmaster') &&
			content.includes('Taskmaster — Unified Task Protocol')
		);
	}

	private hasSkillIntegrationAddon(content: string): boolean {
		return (
			content.includes(SKILL_INTEGRATION_MARK_START) &&
			content.includes(SKILL_INTEGRATION_MARK_END)
		);
	}

	private mergeSkillWithIntegrationAddon(content: string): string {
		const withoutAddon = this.removeMarkedBlock(
			content,
			SKILL_INTEGRATION_MARK_START,
			SKILL_INTEGRATION_MARK_END
		);
		return `${withoutAddon.trimEnd()}\n\n${SKILL_INTEGRATION_ADDENDUM}\n`;
	}

	private removeMarkedBlock(content: string, start: string, end: string): string {
		const startIndex = content.indexOf(start);
		const endIndex = content.indexOf(end);
		if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
			return content;
		}
		const blockEnd = endIndex + end.length;
		const prefix = content.slice(0, startIndex).trimEnd();
		const suffix = content.slice(blockEnd).trimStart();
		if (!prefix) {
			return suffix;
		}
		if (!suffix) {
			return `${prefix}\n`;
		}
		return `${prefix}\n\n${suffix}`;
	}

	private looksLikeUpstreamAgents(content: string): boolean {
		return content.includes('# Global Agent Rules');
	}

	private resolveMode(mode: SkillRunMode | undefined): 'lite' | 'full' {
		if (mode === 'lite' || mode === 'full') {
			return mode;
		}
		return 'full';
	}

	private async safeRead(filePath: string): Promise<string | null> {
		if (!(await this.fileExists(filePath))) {
			return null;
		}
		return readFile(filePath, 'utf-8');
	}

	private async loadRemoteTemplate(url: string, fallback: string): Promise<string> {
		const disableRemote =
			process.env.TM_DISABLE_REMOTE_SKILL_FETCH === '1' ||
			process.env.NODE_ENV === 'test';
		if (disableRemote) {
			return fallback;
		}
		try {
			const response = await fetch(url, {
				headers: { 'User-Agent': 'task-master-ai/skill-run' }
			});
			if (!response.ok) {
				return fallback;
			}
			const text = await response.text();
			return text.trim().length > 0 ? text : fallback;
		} catch {
			return fallback;
		}
	}

	private async ensureCodexTasksGitignore(): Promise<void> {
		const root = path.join(this.projectRoot, '.codex-tasks');
		const file = path.join(root, '.gitignore');
		await mkdir(root, { recursive: true });
		if (!(await this.fileExists(file))) {
			await writeFile(file, '*\n!.gitignore\n', 'utf-8');
			return;
		}
		const content = await readFile(file, 'utf-8');
		if (!content.includes('*')) {
			await appendFile(file, '\n*\n', 'utf-8');
		}
		if (!content.includes('!.gitignore')) {
			await appendFile(file, '!.gitignore\n', 'utf-8');
		}
	}

	private async syncTodoAndMap(
		tag: string | undefined,
		checkpoint: CheckpointState,
		paths: SkillRunPaths,
		mode: 'lite' | 'full'
	): Promise<void> {
		const list = await this.tasksDomain.list({ tag });
		const rows: CsvRow[] = [];
		const mapRows: TaskmasterMapRow[] = [];
		let rowId = 1;
		for (const task of list.tasks) {
			rows.push(this.toCsvRow(task, String(task.id), checkpoint, task.dependencies || []));
			mapRows.push({ rowId, taskId: String(task.id), title: task.title, dependencies: task.dependencies || [] });
			rowId++;
			for (const subtask of task.subtasks || []) {
				const subId = `${task.id}.${subtask.id}`;
				const deps = (subtask.dependencies || []).map((dep) => {
					const depValue = String(dep);
					return depValue.includes('.') ? depValue : `${task.id}.${depValue}`;
				});
				rows.push(this.toCsvRow(subtask, subId, checkpoint, deps));
				mapRows.push({ rowId, taskId: subId, title: subtask.title || `Subtask ${subtask.id}`, dependencies: deps });
				rowId++;
			}
		}
		await writeFile(
			paths.todoCsvPath,
			mode === 'lite' ? this.renderLiteCsv(rows) : this.renderCsv(rows),
			'utf-8'
		);
		if (mode === 'full') {
			const map: TaskmasterMap = { generatedAt: nowIso(), rows: mapRows };
			await writeFile(paths.mapPath, JSON.stringify(map, null, 2), 'utf-8');
		}
	}

	private toCsvRow(
		task: { title?: string; status?: TaskStatus; testStrategy?: string },
		taskId: string,
		checkpoint: CheckpointState,
		dependencies: string[]
	): CsvRow {
		const status = this.mapStatus(task.status || 'pending', checkpoint, taskId);
		return {
			taskId,
			title: task.title || `Task ${taskId}`,
			status,
			acceptanceCriteria: task.testStrategy || '',
			validationCommand: 'echo SKIP',
			completedAt: status === 'DONE' ? nowIso() : '',
			retryCount: checkpoint.attempts[taskId] ?? 0,
			notes: checkpoint.blockedTaskIds.includes(taskId) ? 'blocked by retry limit' : '',
			dependencies
		};
	}

	private mapStatus(status: TaskStatus, checkpoint: CheckpointState, taskId: string): CsvRow['status'] {
		if (checkpoint.doneTaskIds.includes(taskId)) return 'DONE';
		if (checkpoint.blockedTaskIds.includes(taskId)) return 'FAILED';
		if (status === 'done' || status === 'completed') return 'DONE';
		if (status === 'in-progress') return 'IN_PROGRESS';
		if (status === 'blocked' || status === 'cancelled' || status === 'deferred') return 'FAILED';
		return 'TODO';
	}

	private renderCsv(rows: CsvRow[]): string {
		const header = 'id,task,status,acceptance_criteria,validation_command,completed_at,retry_count,notes';
		const lines = rows.map((row, idx) =>
			[
				idx + 1,
				toCsvCell(`[${row.taskId}] ${row.title}`),
				row.status,
				toCsvCell(row.acceptanceCriteria),
				toCsvCell(row.validationCommand),
				toCsvCell(row.completedAt),
				row.retryCount,
				toCsvCell(row.notes)
			].join(',')
		);
		return `${header}\n${lines.join('\n')}\n`;
	}

	private renderLiteCsv(rows: CsvRow[]): string {
		const header = 'id,task,status,completed_at,notes';
		const lines = rows.map((row, idx) =>
			[
				idx + 1,
				toCsvCell(`[${row.taskId}] ${row.title}`),
				this.mapStatusLite(row.status),
				toCsvCell(row.completedAt),
				toCsvCell(row.notes)
			].join(',')
		);
		return `${header}\n${lines.join('\n')}\n`;
	}

	private mapStatusLite(status: CsvRow['status']): 'TODO' | 'DONE' {
		return status === 'DONE' ? 'DONE' : 'TODO';
	}

	private async appendLedger(file: string, entry: LedgerEntry): Promise<void> {
		await appendFile(file, `${JSON.stringify(entry)}\n`, 'utf-8');
	}

	private async loadCheckpoint(file: string): Promise<CheckpointState> {
		if (!(await this.fileExists(file))) {
			return { updatedAt: nowIso(), attempts: {}, doneTaskIds: [], blockedTaskIds: [] };
		}
		const raw = await readFile(file, 'utf-8');
		const parsed = JSON.parse(raw) as CheckpointState;
		return {
			updatedAt: parsed.updatedAt || nowIso(),
			attempts: parsed.attempts || {},
			doneTaskIds: parsed.doneTaskIds || [],
			blockedTaskIds: parsed.blockedTaskIds || [],
			lastTaskId: parsed.lastTaskId
		};
	}

	private async saveCheckpoint(file: string, checkpoint: CheckpointState): Promise<void> {
		checkpoint.updatedAt = nowIso();
		await writeFile(file, JSON.stringify(checkpoint, null, 2), 'utf-8');
	}

	private async fileExists(filePath: string): Promise<boolean> {
		try {
			await stat(filePath);
			return true;
		} catch {
			return false;
		}
	}

	private pushUnique(items: string[], value: string): string[] {
		if (items.includes(value)) {
			return items;
		}
		return [...items, value];
	}

	private resolveDefaultAgentsPath(): string {
		const agentsUpper = path.join(this.projectRoot, 'AGENTS.md');
		if (existsSync(agentsUpper)) {
			return agentsUpper;
		}
		const agentsLower = path.join(this.projectRoot, 'agent.md');
		if (existsSync(agentsLower)) {
			return agentsLower;
		}
		return agentsUpper;
	}
}
