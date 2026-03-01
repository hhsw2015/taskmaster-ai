/**
 * @fileoverview Sync command for syncing local tasks to an existing Hamster brief
 */

import { AuthManager, type TmCore, createTmCore } from '@tm/core';
import chalk from 'chalk';
import { Command } from 'commander';
import inquirer from 'inquirer';
import ora, { type Ora } from 'ora';
import { ensureAuthenticated } from '../utils/auth-guard.js';
import {
	selectBriefFromInput,
	selectBriefInteractive
} from '../utils/brief-selection.js';
import { displayError } from '../utils/error-handler.js';
import { ensureOrgSelected } from '../utils/org-selection.js';
import { getProjectRoot } from '../utils/project-root.js';

export interface SyncPushOptions {
	brief?: string;
	tag?: string;
	yes?: boolean;
	nonInteractive?: boolean;
}

export interface SyncCommandResult {
	success: boolean;
	action: 'push' | 'cancelled';
	briefId?: string;
	tag?: string;
	taskCount?: number;
	message?: string;
}

export class SyncCommand extends Command {
	private taskMasterCore?: TmCore;
	private lastResult?: SyncCommandResult;

	constructor(name?: string) {
		super(name || 'sync');

		this.description('Sync local tasks to an existing Hamster brief');
		this.addPushCommand();

		// Default action: sync push
		this.action(async (options?: SyncPushOptions) => {
			await this.executePush(options || {});
		});
	}

	private addPushCommand(): void {
		this.command('push')
			.description('Push local tasks to an existing Hamster brief')
			.option(
				'--brief <briefOrUrl>',
				'Target brief ID or Hamster brief URL (defaults to current context brief)'
			)
			.option('--tag <tag>', 'Local tag to sync (defaults to active tag)')
			.option('-y, --yes', 'Skip interactive prompts and run non-interactively')
			.option('--non-interactive', 'Force non-interactive mode (same as --yes)')
			.addHelpText(
				'after',
				`
Examples:
  $ tm sync push --brief <brief-id-or-url>
  $ tm sync push --brief <brief-id-or-url> --tag master_zh
  $ tm sync push --yes --brief https://tryhamster.com/home/<org>/briefs/<id>
`
			)
			.action(async (options: SyncPushOptions) => {
				await this.executePush(options);
			});
	}

	private isNonInteractive(options?: SyncPushOptions): boolean {
		return !!(options?.yes || options?.nonInteractive);
	}

	private async initializeServices(): Promise<void> {
		if (this.taskMasterCore) {
			return;
		}

		this.taskMasterCore = await createTmCore({
			projectPath: getProjectRoot()
		});
	}

	private async executePush(options: SyncPushOptions): Promise<void> {
		let spinner: Ora | undefined;

		try {
			const nonInteractive = this.isNonInteractive(options);
			const authResult = await ensureAuthenticated({
				actionName: 'sync local tasks to an existing Hamster brief',
				skipConfirmation: nonInteractive,
				nonInteractive
			});

			if (!authResult.authenticated) {
				this.lastResult = {
					success: false,
					action: 'cancelled',
					message:
						authResult.error ||
						(nonInteractive
							? 'Authentication required'
							: 'User cancelled authentication')
				};
				if (authResult.error) {
					console.error(chalk.red(`\n${authResult.error}\n`));
				}
				return;
			}

			await this.initializeServices();

			const targetResult = await this.ensureTargetBrief(
				options,
				nonInteractive
			);
			if (!targetResult.success) {
				this.lastResult = {
					success: false,
					action: 'cancelled',
					message: targetResult.message || 'No target brief selected'
				};

				if (targetResult.message) {
					console.error(chalk.yellow(`\n${targetResult.message}\n`));
				}
				return;
			}

			const context = this.taskMasterCore!.auth.getContext();
			if (!context?.briefId || !context.orgId) {
				this.lastResult = {
					success: false,
					action: 'cancelled',
					message:
						'Missing brief or organization context. Select a brief first with "tm context brief <url>".'
				};
				console.error(
					chalk.red(
						'\nMissing brief or organization context. Select a brief first with "tm context brief <url>".\n'
					)
				);
				return;
			}

			const sourceTag =
				options.tag || this.taskMasterCore!.config.getActiveTag();

			if (!nonInteractive) {
				const { confirmed } = await inquirer.prompt<{ confirmed: boolean }>([
					{
						type: 'confirm',
						name: 'confirmed',
						message: `Sync local tag "${sourceTag}" to brief "${context.briefName || context.briefId}"?`,
						default: true
					}
				]);

				if (!confirmed) {
					this.lastResult = {
						success: false,
						action: 'cancelled',
						message: 'Sync cancelled'
					};
					console.log(chalk.gray('\n  Sync cancelled.\n'));
					return;
				}
			}

			spinner = ora('Syncing local tasks to Hamster brief...').start();
			const result = await this.taskMasterCore!.integration.exportTasks({
				briefId: context.briefId,
				orgId: context.orgId,
				tag: sourceTag
			});

			if (result.success) {
				spinner.succeed(`Synced ${result.taskCount} task(s)`);
				console.log(
					chalk.gray(
						`  Brief: ${context.briefName || context.briefId}\n  Tag: ${sourceTag}\n`
					)
				);
				this.lastResult = {
					success: true,
					action: 'push',
					briefId: context.briefId,
					tag: sourceTag,
					taskCount: result.taskCount,
					message: result.message
				};
			} else {
				spinner.fail('Sync failed');
				const errorMessage = result.error?.message || 'Unknown error occurred';
				console.error(chalk.red(`\n${errorMessage}\n`));
				this.lastResult = {
					success: false,
					action: 'push',
					briefId: context.briefId,
					tag: sourceTag,
					taskCount: 0,
					message: errorMessage
				};
			}
		} catch (error: any) {
			if (spinner?.isSpinning) {
				spinner.fail('Sync failed');
			}
			displayError(error);
		}
	}

	private async ensureTargetBrief(
		options: SyncPushOptions,
		nonInteractive: boolean
	): Promise<{ success: boolean; message?: string }> {
		if (!this.taskMasterCore) {
			return { success: false, message: 'Task Master core is not initialized' };
		}

		if (options.brief?.trim()) {
			await selectBriefFromInput(
				AuthManager.getInstance(),
				options.brief.trim(),
				this.taskMasterCore
			);
			return { success: true };
		}

		const context = this.taskMasterCore.auth.getContext();
		if (context?.briefId) {
			return { success: true };
		}

		if (nonInteractive) {
			return {
				success: false,
				message:
					'No brief selected. Provide --brief <brief-id-or-url> or run "tm context brief <brief-url>" first.'
			};
		}

		const authManager = AuthManager.getInstance();
		const orgResult = await ensureOrgSelected(authManager, {
			promptMessage: 'Select an organization for sync:',
			forceSelection: false
		});

		if (!orgResult.success || !orgResult.orgId) {
			return {
				success: false,
				message: orgResult.message || 'Organization selection cancelled'
			};
		}

		const briefResult = await selectBriefInteractive(
			authManager,
			orgResult.orgId
		);
		if (!briefResult.success || !briefResult.briefId) {
			return {
				success: false,
				message: briefResult.message || 'Brief selection cancelled'
			};
		}

		return { success: true };
	}

	public getLastResult(): SyncCommandResult | undefined {
		return this.lastResult;
	}

	static register(program: Command, name?: string): SyncCommand {
		const syncCommand = new SyncCommand(name);
		program.addCommand(syncCommand);
		return syncCommand;
	}
}
