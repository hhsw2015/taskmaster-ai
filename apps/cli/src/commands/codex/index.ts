/**
 * @fileoverview Codex command group for skill-based longrun execution.
 */

import { Command } from 'commander';
import { InitCommand } from './init.command.js';
import { RunCommand } from './run.command.js';

export class CodexCommand extends Command {
	constructor() {
		super('codex');
		this.description('Codex native extension commands (skill init/run)');
		this.alias('skill-run');
		this.addCommand(new InitCommand());
		this.addCommand(new RunCommand());
	}

	static register(program: Command): CodexCommand {
		const cmd = new CodexCommand();
		program.addCommand(cmd);
		return cmd;
	}
}
