/**
 * @fileoverview Next Command - Get next action in TDD workflow
 */

import { type TaskExecutor, type TmCore, createTmCore } from '@tm/core';
import { Command } from 'commander';
import { getProjectRoot } from '../../utils/project-root.js';
import { type AutopilotBaseOptions, OutputFormatter } from './shared.js';

type NextOptions = AutopilotBaseOptions;

/**
 * Next Command - Get next action details
 */
export class NextCommand extends Command {
	constructor() {
		super('next');

		this.description(
			'Get the next action to perform in the TDD workflow'
		).action(async (options: NextOptions) => {
			await this.execute(options);
		});
	}

	private async execute(options: NextOptions): Promise<void> {
		// Inherit parent options
		const parentOpts = this.parent?.opts() as AutopilotBaseOptions;

		// Initialize mergedOptions with defaults (projectRoot will be set in try block)
		let mergedOptions: NextOptions = {
			...parentOpts,
			...options,
			projectRoot: '' // Will be set in try block
		};

		const formatter = new OutputFormatter(
			options.json || parentOpts?.json || false
		);

		try {
			// Resolve project root inside try block to catch any errors
			const projectRoot = getProjectRoot(
				options.projectRoot || parentOpts?.projectRoot
			);

			// Update mergedOptions with resolved project root
			mergedOptions = {
				...mergedOptions,
				projectRoot
			};

			// Initialize TmCore facade
			const tmCore = await createTmCore({ projectPath: projectRoot });

			// Check if workflow exists
			if (!(await tmCore.workflow.hasWorkflow())) {
				formatter.error('No active workflow', {
					suggestion: 'Start a workflow with: autopilot start <taskId>'
				});
				process.exit(1);
			}

			// Resume workflow and get next action
			await tmCore.workflow.resume();
			const status = tmCore.workflow.getStatus();
			const nextAction = tmCore.workflow.getNextAction();
			const context = tmCore.workflow.getContext();
			const executor = this.resolveExecutor(tmCore, mergedOptions.executor);

			// Get current phase info
			const phase = status.phase;
			const tddPhase = status.tddPhase;
			const currentSubtask = status.currentSubtask;

			if (phase === 'COMPLETE') {
				formatter.success('Workflow complete', {
					message: 'All subtasks have been completed',
					taskId: status.taskId
				});
				return;
			}

			// Build executable command hint for RED/GREEN implementation phases
			const executionHint = await this.buildExecutionHint(
				tmCore,
				status.taskId,
				status.phase,
				status.tddPhase,
				status.currentSubtask?.id,
				executor
			);

			const nextSteps = executionHint?.command
				? `${nextAction.nextSteps}\n\nLaunch coding agent:\n${executionHint.command}`
				: nextAction.nextSteps;

			// Output next action using the facade's guidance
			const output = {
				action: nextAction.action,
				description: nextAction.description,
				phase,
				tddPhase,
				taskId: status.taskId,
				branchName: status.branchName,
				subtask: currentSubtask
					? {
							id: currentSubtask.id,
							title: currentSubtask.title,
							attempts: currentSubtask.attempts
						}
					: null,
				nextSteps,
				lastTestResults: context.lastTestResults,
				execution: executionHint ?? { executor }
			};

			if (mergedOptions.json) {
				formatter.output(output);
			} else {
				formatter.success('Next action', output);
			}
		} catch (error) {
			formatter.error((error as Error).message);
			if (mergedOptions.verbose) {
				console.error((error as Error).stack);
			}
			process.exit(1);
		}
	}

	private async buildExecutionHint(
		tmCore: TmCore,
		taskId: string,
		phase: string,
		tddPhase: string | undefined,
		subtaskId: string | undefined,
		executor: TaskExecutor
	): Promise<{
		executor: TaskExecutor;
		workItemId?: string;
		command?: string;
	} | null> {
		if (phase !== 'SUBTASK_LOOP' || !subtaskId) {
			return null;
		}

		// Only RED/GREEN phases need coding-agent execution guidance
		if (tddPhase !== 'RED' && tddPhase !== 'GREEN') {
			return { executor };
		}

		const workItemId = this.composeWorkItemId(taskId, subtaskId);
		const dryRunResult = await tmCore.tasks.start(workItemId, {
			dryRun: true,
			force: true,
			updateStatus: false,
			executor
		});

		const command = dryRunResult.command
			? this.buildShellCommand(
					dryRunResult.command.executable,
					dryRunResult.command.args
				)
			: undefined;

		return { executor, workItemId, command };
	}

	private composeWorkItemId(taskId: string, subtaskId: string): string {
		return subtaskId.includes('.') ? subtaskId : `${taskId}.${subtaskId}`;
	}

	private buildShellCommand(executable: string, args: string[]): string {
		return [executable, ...args.map((arg) => this.shellEscapeArg(arg))].join(
			' '
		);
	}

	private shellEscapeArg(value: string): string {
		if (!value) return "''";
		return `'${value.replace(/'/g, `'\"'\"'`)}'`;
	}

	private resolveExecutor(tmCore: TmCore, optionValue?: string): TaskExecutor {
		const configuredExecutor = this.getConfiguredExecutor(tmCore);
		const inferredExecutor = this.inferExecutorFromConfig(tmCore);
		const executorValue =
			optionValue ??
			process.env.TASKMASTER_EXECUTOR ??
			configuredExecutor ??
			inferredExecutor ??
			'claude';
		const normalized = executorValue.toLowerCase();

		if (normalized === 'claude' || normalized === 'codex') {
			return normalized;
		}

		throw new Error(
			`Invalid executor "${executorValue}". Supported values: claude, codex.`
		);
	}

	private getConfiguredExecutor(tmCore: TmCore): string | undefined {
		const config = tmCore.config.getConfig();
		const customConfig = config.custom as Record<string, unknown> | undefined;
		const executor = customConfig?.executor;
		return typeof executor === 'string' ? executor : undefined;
	}

	private inferExecutorFromConfig(tmCore: TmCore): TaskExecutor | undefined {
		const config = tmCore.config.getConfig() as Record<string, unknown>;

		if (this.isCodexProvider(config.aiProvider)) {
			return 'codex';
		}

		const models = this.asObject(config.models);
		if (this.isCodexModelConfig(models?.main)) {
			return 'codex';
		}

		if (this.isNonEmptyObject(config.codexCli)) {
			return 'codex';
		}

		return undefined;
	}

	private isCodexModelConfig(value: unknown): boolean {
		if (typeof value === 'string') {
			return this.isCodexModelId(value);
		}

		const modelConfig = this.asObject(value);
		if (!modelConfig) return false;

		return (
			this.isCodexProvider(modelConfig.provider) ||
			this.isCodexModelId(modelConfig.modelId)
		);
	}

	private isCodexProvider(provider: unknown): boolean {
		if (typeof provider !== 'string') return false;
		const normalized = provider.trim().toLowerCase();
		return (
			normalized === 'codex' ||
			normalized === 'codex-cli' ||
			normalized === 'codex-lb'
		);
	}

	private isCodexModelId(modelId: unknown): boolean {
		return (
			typeof modelId === 'string' && modelId.toLowerCase().includes('codex')
		);
	}

	private asObject(value: unknown): Record<string, unknown> | undefined {
		if (typeof value === 'object' && value !== null) {
			return value as Record<string, unknown>;
		}
		return undefined;
	}

	private isNonEmptyObject(value: unknown): boolean {
		const obj = this.asObject(value);
		return Boolean(obj && Object.keys(obj).length > 0);
	}
}
