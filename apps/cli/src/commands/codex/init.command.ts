/**
 * @fileoverview Codex longrun init command.
 */

import { createTmCore } from '@tm/core';
import chalk from 'chalk';
import { Command } from 'commander';
import path from 'path';
import { displayError } from '../../utils/error-handler.js';
import { getProjectRoot } from '../../utils/project-root.js';

interface InitOptions {
	project?: string;
	skillPath?: string;
	agentsPath?: string;
	agentsMode?: 'append' | 'skip' | 'fail';
	mode?: 'lite' | 'full' | 'auto';
	sessionDir?: string;
	json?: boolean;
}

export class InitCommand extends Command {
	constructor() {
		super('init');
		this.description('Initialize AGENTS.md + Skill assets for codex longrun mode')
			.option('-p, --project <path>', 'Project root directory')
			.option('--skill-path <path>', 'Custom SKILL.md path relative to project root')
			.option('--agents-path <path>', 'Custom AGENTS.md path relative to project root')
			.option(
				'--agents-mode <mode>',
				'How to handle existing AGENTS without hook: append|skip|fail',
				'append'
			)
			.option('--mode <mode>', 'Execution mode: lite|full|auto', 'full')
			.option('--session-dir <path>', 'Custom session directory relative to project root')
			.option('--json', 'Output JSON')
			.action(async (options: InitOptions) => {
				await this.execute(options);
			});
	}

	private async execute(options: InitOptions): Promise<void> {
		try {
			const projectPath = getProjectRoot(options.project);
			const tmCore = await createTmCore({ projectPath });
			const result = await tmCore.skillRun.initAssets({
				skillPath: options.skillPath,
				agentsPath: options.agentsPath,
				agentsMode: options.agentsMode,
				mode: options.mode,
				sessionDir: options.sessionDir
			});
			await tmCore.close();
			const loadHints = this.buildLoadHints(projectPath, result.paths);
			const startCommand = result.paths.launcherCommand;
			const immediateAction =
				loadHints.length === 2
					? `Load ${loadHints[0]} -> load ${loadHints[1]} -> run ${startCommand}`
					: undefined;

			if (options.json) {
				console.log(
					JSON.stringify(
						{
							...result,
							loadHints,
							start_command: startCommand,
							immediate_action: immediateAction
						},
						null,
						2
					)
				);
				return;
			}

			console.log(chalk.green('Codex longrun assets initialized.'));
			console.log(chalk.gray(`  AGENTS: ${result.paths.agentsPath}`));
			console.log(chalk.gray(`  SKILL : ${result.paths.skillPath}`));
			console.log(chalk.gray(`  Start : ${startCommand}`));
			console.log(chalk.gray(`  Session: ${result.paths.sessionDir}`));
			if (loadHints.length === 2) {
				console.log(
					chalk.white(`  Ask Codex to load: ${loadHints[0]} then ${loadHints[1]}`)
				);
				console.log(`TM_IMMEDIATE_ACTION: LOAD ${loadHints[0]}`);
				console.log(`TM_IMMEDIATE_ACTION: LOAD ${loadHints[1]}`);
				console.log(`TM_IMMEDIATE_ACTION: RUN ${startCommand}`);
			}
			if (result.created.length > 0) {
				console.log(chalk.green(`  Created: ${result.created.join(', ')}`));
			}
			if (result.updated.length > 0) {
				console.log(chalk.yellow(`  Updated: ${result.updated.join(', ')}`));
			}
		} catch (error: unknown) {
			displayError(error, { skipExit: true });
			process.exit(1);
		}
	}

	private buildLoadHints(
		projectPath: string,
		paths: {
			skillPath: string;
			skillAgentsPath?: string;
		}
	): string[] {
		const skillPath = paths.skillPath;
		const skillAgentsPath =
			paths.skillAgentsPath ?? path.join(path.dirname(paths.skillPath), 'AGENTS.md');
		return [skillAgentsPath, skillPath].map((absolutePath) => {
			const rel = path.relative(projectPath, absolutePath).split(path.sep).join('/');
			return `@${rel}`;
		});
	}
}
