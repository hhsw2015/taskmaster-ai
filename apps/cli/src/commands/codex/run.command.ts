/**
 * @fileoverview Codex longrun run command.
 */

import { createTmCore } from '@tm/core';
import chalk from 'chalk';
import { Command } from 'commander';
import { displayError } from '../../utils/error-handler.js';
import { getProjectRoot } from '../../utils/project-root.js';

interface RunOptions {
	project?: string;
	tag?: string;
	maxRetries?: string;
	skillPath?: string;
	agentsPath?: string;
	agentsMode?: 'append' | 'skip' | 'fail';
	mode?: 'lite' | 'full' | 'auto';
	sessionDir?: string;
	executor?: string;
	model?: string;
	reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
	execIdleTimeoutMs?: string;
	execHardTimeoutMs?: string;
	execTimeoutMs?: string;
	terminateOnResult?: boolean;
	fullAuto?: boolean;
	skipGitRepoCheck?: boolean;
	maxTasks?: string;
	continueOnFailure?: boolean;
	json?: boolean;
}

export class RunCommand extends Command {
	constructor() {
		super('run');
		this.alias('start');
		this.description('Run long-horizon codex execution with Taskmaster task scheduling')
			.option('-p, --project <path>', 'Project root directory')
			.option('-t, --tag <tag>', 'Tag context for tasks')
			.option('--max-retries <n>', 'Retries before marking a task blocked', '3')
			.option('--skill-path <path>', 'Custom SKILL.md path relative to project root')
			.option('--agents-path <path>', 'Custom AGENTS.md path relative to project root')
			.option(
				'--agents-mode <mode>',
				'How to handle existing AGENTS without hook: append|skip|fail',
				'append'
			)
			.option('--mode <mode>', 'Execution mode: lite|full|auto', 'full')
			.option('--session-dir <path>', 'Custom session directory relative to project root')
			.option('-e, --executor <cmd>', 'Executor command', 'codex')
			.option('-m, --model <model>', 'Model for codex exec')
			.option('--reasoning-effort <level>', 'low|medium|high|xhigh')
			.option(
				'--exec-idle-timeout-ms <ms>',
				'Per-task idle timeout in milliseconds (0 to disable)'
			)
			.option(
				'--exec-hard-timeout-ms <ms>',
				'Per-task hard timeout in milliseconds (0 to disable)'
			)
			.option(
				'--exec-timeout-ms <ms>',
				'[Deprecated] Alias of --exec-hard-timeout-ms'
			)
			.option(
				'--no-terminate-on-result',
				'Do not terminate executor after TM_RESULT is detected'
			)
			.option('--no-full-auto', 'Disable --full-auto for codex exec')
			.option('--no-skip-git-repo-check', 'Disable --skip-git-repo-check for codex exec')
			.option('--max-tasks <n>', 'Stop after N execution attempts')
			.option('--no-continue-on-failure', 'Stop when one task fails')
			.option('--json', 'Output JSON summary')
			.action(async (options: RunOptions) => {
				await this.execute(options);
			});
	}

	private async execute(options: RunOptions): Promise<void> {
		try {
			const projectPath = getProjectRoot(options.project);
			const tmCore = await createTmCore({ projectPath });
			console.log(chalk.cyan('Starting Codex longrun execution...'));

			const result = await tmCore.skillRun.run({
				tag: options.tag,
				maxRetries: Number.parseInt(options.maxRetries || '3', 10),
				skillPath: options.skillPath,
				agentsPath: options.agentsPath,
				agentsMode: options.agentsMode,
				mode: options.mode,
				sessionDir: options.sessionDir,
				executor: options.executor,
				model: options.model,
				reasoningEffort: options.reasoningEffort,
				execIdleTimeoutMs: this.parseOptionalInteger(options.execIdleTimeoutMs),
				execHardTimeoutMs: this.parseOptionalInteger(options.execHardTimeoutMs),
				execTimeoutMs: this.parseOptionalInteger(options.execTimeoutMs),
				terminateOnResult: options.terminateOnResult,
				fullAuto: options.fullAuto,
				skipGitRepoCheck: options.skipGitRepoCheck,
				maxTasks: options.maxTasks
					? Number.parseInt(options.maxTasks, 10)
					: undefined,
				continueOnFailure: options.continueOnFailure,
				callbacks: {
					onTaskStart: (task, attempt) => {
						console.log(
							chalk.white(`\n[Task ${task.id}] ${task.title} (attempt ${attempt})`)
						);
					},
					onTaskEnd: (summary) => {
						console.log(
							chalk.gray(
								`[${summary.status}] ${summary.taskId} exit=${summary.exitCode} duration=${summary.durationMs}ms log=${summary.logFile}`
							)
						);
					}
				}
			});
			await tmCore.close();

			if (options.json) {
				console.log(JSON.stringify(result, null, 2));
				return;
			}

			console.log('\n' + chalk.bold('Longrun Summary'));
			console.log(chalk.gray(`  Final status: ${result.finalStatus}`));
			console.log(chalk.gray(`  Completed: ${result.completedTaskIds.length}`));
			console.log(chalk.gray(`  Blocked: ${result.blockedTaskIds.length}`));
			console.log(chalk.gray(`  Total runs: ${result.totalRuns}`));
		} catch (error: unknown) {
			displayError(error, { skipExit: true });
			process.exit(1);
		}
	}

	private parseOptionalInteger(value: string | undefined): number | undefined {
		if (typeof value !== 'string' || value.trim().length === 0) {
			return undefined;
		}
		const parsed = Number.parseInt(value, 10);
		return Number.isNaN(parsed) ? undefined : parsed;
	}
}
