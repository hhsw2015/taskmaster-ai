/**
 * @fileoverview TaskExecutionService for handling task execution business logic
 * Extracted from CLI start command to be reusable across CLI and extension
 */

import type { Task } from '../../../common/types/index.js';
import { runCodexExecutionPreflight } from '../../../common/utils/codex-execution-preflight.js';
import type { TaskService } from './task-service.js';

export type TaskExecutor = 'claude' | 'codex';

export interface StartTaskOptions {
	subtaskId?: string;
	dryRun?: boolean;
	updateStatus?: boolean;
	force?: boolean;
	silent?: boolean;
	executor?: TaskExecutor;
}

export interface StartTaskResult {
	task: Task | null;
	found: boolean;
	started: boolean;
	subtaskId?: string;
	subtask?: any;
	error?: string;
	executionOutput?: string;
	/** Command to execute (for CLI to run directly) */
	command?: {
		executable: string;
		args: string[];
		cwd: string;
	};
}

export interface ConflictCheckResult {
	canProceed: boolean;
	conflictingTasks: Task[];
	reason?: string;
}

/**
 * TaskExecutionService handles the business logic for starting and executing tasks
 */
export class TaskExecutionService {
	constructor(
		private taskService: TaskService,
		private projectRoot: string = process.cwd()
	) {}

	/**
	 * Start working on a task with comprehensive business logic
	 */
	async startTask(
		taskId: string,
		options: StartTaskOptions = {}
	): Promise<StartTaskResult> {
		try {
			// Handle subtask IDs by extracting parent task ID
			const { parentId, subtaskId } = this.parseTaskId(taskId);

			// Check for in-progress task conflicts
			if (!options.force) {
				const conflictCheck = await this.checkInProgressConflicts(taskId);
				if (!conflictCheck.canProceed) {
					return {
						task: null,
						found: false,
						started: false,
						error: `Conflicting tasks in progress: ${conflictCheck.conflictingTasks.map((t) => `#${t.id}: ${t.title}`).join(', ')}`
					};
				}
			}

			// Get the actual task (parent task if dealing with subtask)
			const task = await this.taskService.getTask(parentId);
			if (!task) {
				return {
					task: null,
					found: false,
					started: false,
					error: `Task ${parentId} not found`
				};
			}

			// Find the specific subtask if provided
			let subtask = undefined;
			if (subtaskId && task.subtasks) {
				subtask = task.subtasks.find((st) => String(st.id) === subtaskId);
			}

			const executor = this.normalizeExecutor(options.executor);
			if (!options.dryRun && executor === 'codex') {
				const preflight = runCodexExecutionPreflight(this.projectRoot);
				if (!preflight.success) {
					return {
						task,
						found: true,
						started: false,
						subtaskId,
						subtask,
						error: this.formatCodexPreflightError(preflight.errors)
					};
				}
			}

			// Update task status to in-progress if not disabled
			if (options.updateStatus && !options.dryRun) {
				try {
					await this.taskService.updateTaskStatus(parentId, 'in-progress');
				} catch (error) {
					// Log but don't fail - status update is not critical
					console.warn(
						`Could not update task status: ${error instanceof Error ? error.message : String(error)}`
					);
				}
			}

			// Prepare execution command instead of executing directly
			let started = false;
			let executionOutput = 'Task ready to execute';
			let command = undefined;

			if (!options.dryRun) {
				// Prepare the command for execution by the CLI
				command = await this.prepareExecutionCommand(task, subtask, executor);
				started = !!command; // Command prepared successfully
				executionOutput = command
					? `Command prepared: ${command.executable} ${command.args.join(' ')}`
					: 'Failed to prepare execution command';
			} else {
				// For dry-run, just show that we would execute
				started = true;
				executionOutput = 'Dry run - task would be executed';
				// Also prepare command for dry run display
				command = await this.prepareExecutionCommand(task, subtask, executor);
			}

			return {
				task,
				found: true,
				started,
				subtaskId,
				subtask,
				executionOutput,
				command: command || undefined
			};
		} catch (error) {
			return {
				task: null,
				found: false,
				started: false,
				error: error instanceof Error ? error.message : String(error)
			};
		}
	}

	private formatCodexPreflightError(errors: string[]): string {
		const lines = errors.map((error) => `- ${error}`).join('\n');
		return `Codex execution blocked by permission preflight checks:\n${lines}`;
	}

	/**
	 * Check for existing in-progress tasks and determine conflicts
	 */
	async checkInProgressConflicts(
		targetTaskId: string
	): Promise<ConflictCheckResult> {
		const allTasks = await this.taskService.getTaskList();
		const inProgressTasks = allTasks.tasks.filter(
			(task) => task.status === 'in-progress'
		);

		// If the target task is already in-progress, that's fine
		const targetTaskInProgress = inProgressTasks.find(
			(task) => task.id === targetTaskId
		);
		if (targetTaskInProgress) {
			return { canProceed: true, conflictingTasks: [] };
		}

		// Check if target is a subtask and its parent is in-progress
		const isSubtask = targetTaskId.includes('.');
		if (isSubtask) {
			const parentTaskId = targetTaskId.split('.')[0];
			const parentInProgress = inProgressTasks.find(
				(task) => task.id === parentTaskId
			);
			if (parentInProgress) {
				return { canProceed: true, conflictingTasks: [] }; // Allow subtasks when parent is in-progress
			}
		}

		// Check if other unrelated tasks are in-progress
		const conflictingTasks = inProgressTasks.filter((task) => {
			if (task.id === targetTaskId) return false;

			// If target is a subtask, exclude its parent from conflicts
			if (isSubtask) {
				const parentTaskId = targetTaskId.split('.')[0];
				if (task.id === parentTaskId) return false;
			}

			// If the in-progress task is a subtask of our target parent, exclude it
			if (task.id.toString().includes('.')) {
				const taskParentId = task.id.toString().split('.')[0];
				if (isSubtask && taskParentId === targetTaskId.split('.')[0]) {
					return false;
				}
			}

			return true;
		});

		if (conflictingTasks.length > 0) {
			return {
				canProceed: false,
				conflictingTasks,
				reason: 'Other tasks are already in progress'
			};
		}

		return { canProceed: true, conflictingTasks: [] };
	}

	/**
	 * Get the next available task to start
	 */
	async getNextAvailableTask(): Promise<string | null> {
		const nextTask = await this.taskService.getNextTask();
		return nextTask?.id || null;
	}

	/**
	 * Parse a task ID to determine if it's a subtask and extract components
	 */
	private parseTaskId(taskId: string): {
		parentId: string;
		subtaskId?: string;
	} {
		if (taskId.includes('.')) {
			const [parentId, subtaskId] = taskId.split('.');
			return { parentId, subtaskId };
		}
		return { parentId: taskId };
	}

	/**
	 * Check if a task can be started (no conflicts)
	 */
	async canStartTask(taskId: string, force = false): Promise<boolean> {
		if (force) return true;

		const conflictCheck = await this.checkInProgressConflicts(taskId);
		return conflictCheck.canProceed;
	}

	/**
	 * Prepare execution command for the CLI to run
	 */
	private async prepareExecutionCommand(
		task: Task,
		subtask?: any,
		executor: TaskExecutor = 'claude'
	): Promise<{ executable: string; args: string[]; cwd: string } | null> {
		try {
			// Format the task into a prompt
			const taskPrompt = this.formatTaskPrompt(task, subtask);
			const executable = executor;
			const args = this.getExecutionArgs(executor, taskPrompt);
			const cwd = this.projectRoot;

			return { executable, args, cwd };
		} catch (error) {
			console.warn(
				`Failed to prepare execution command: ${error instanceof Error ? error.message : String(error)}`
			);
			return null;
		}
	}

	private normalizeExecutor(executor?: string): TaskExecutor {
		if (!executor) {
			return 'claude';
		}

		const normalized = executor.toLowerCase();
		if (normalized === 'claude' || normalized === 'codex') {
			return normalized;
		}

		console.warn(
			`Unknown executor "${executor}", defaulting to "claude". Supported executors: claude, codex.`
		);
		return 'claude';
	}

	private getExecutionArgs(executor: TaskExecutor, taskPrompt: string): string[] {
		if (executor === 'codex') {
			// Use interactive Codex mode for "start" flows, mirroring Claude interactive behavior.
			return [taskPrompt];
		}
		return [taskPrompt];
	}

	/**
	 * Format task into a prompt suitable for execution
	 */
	private formatTaskPrompt(task: Task, subtask?: any): string {
		const workItem = subtask || task;
		const itemType = subtask ? 'Subtask' : 'Task';
		const itemId = subtask ? `${task.id}.${subtask.id}` : task.id;

		let prompt = `${itemType} #${itemId}: ${workItem.title}\n\n`;

		if (workItem.description) {
			prompt += `Description:\n${workItem.description}\n\n`;
		}

		if (workItem.details) {
			prompt += `Implementation Details:\n${workItem.details}\n\n`;
		}

		if (workItem.testStrategy) {
			prompt += `Test Strategy:\n${workItem.testStrategy}\n\n`;
		}

		if (task.dependencies && task.dependencies.length > 0) {
			prompt += `Dependencies: ${task.dependencies.join(', ')}\n\n`;
		}

		prompt += `Please help me implement this ${itemType.toLowerCase()}.`;

		return prompt;
	}

	/**
	 * Get task with subtask resolution
	 */
	async getTaskWithSubtask(
		taskId: string
	): Promise<{ task: Task | null; subtask?: any; subtaskId?: string }> {
		const { parentId, subtaskId } = this.parseTaskId(taskId);

		const task = await this.taskService.getTask(parentId);
		if (!task) {
			return { task: null };
		}

		if (subtaskId && task.subtasks) {
			const subtask = task.subtasks.find((st) => String(st.id) === subtaskId);
			return { task, subtask, subtaskId };
		}

		return { task };
	}
}
