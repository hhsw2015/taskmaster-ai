import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveTaskMasterPackageMetadata } from './index.js';

const createdDirs: string[] = [];

function createTempDir(): string {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-constants-'));
	createdDirs.push(tempDir);
	return tempDir;
}

function writeJson(filePath: string, data: unknown): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

afterEach(() => {
	for (const dir of createdDirs.splice(0, createdDirs.length)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
	delete process.env.npm_package_version;
});

describe('resolveTaskMasterPackageMetadata', () => {
	it('should resolve metadata from the ancestor CLI package.json', () => {
		const rootDir = createTempDir();
		const nestedDir = path.join(rootDir, 'packages', 'tm-core', 'src', 'common');

		writeJson(path.join(rootDir, 'package.json'), {
			name: '@example/task-master-ai',
			version: '9.9.9',
			bin: {
				'task-master': 'dist/task-master.js'
			}
		});
		writeJson(path.join(rootDir, 'packages', 'tm-core', 'package.json'), {
			name: '@tm/core',
			version: ''
		});

		const metadata = resolveTaskMasterPackageMetadata(nestedDir);

		expect(metadata).toEqual({
			name: '@example/task-master-ai',
			version: '9.9.9'
		});
	});

	it('should fall back to npm_package_version when no CLI package.json is found', () => {
		const nestedDir = path.join(createTempDir(), 'a', 'b', 'c');
		fs.mkdirSync(nestedDir, { recursive: true });
		process.env.npm_package_version = '1.2.3-test';

		const metadata = resolveTaskMasterPackageMetadata(nestedDir);

		expect(metadata).toEqual({
			name: 'task-master-ai',
			version: '1.2.3-test'
		});
	});

	it('should return unknown version when no package metadata is available', () => {
		const nestedDir = path.join(createTempDir(), 'x', 'y');
		fs.mkdirSync(nestedDir, { recursive: true });

		const metadata = resolveTaskMasterPackageMetadata(nestedDir);

		expect(metadata).toEqual({
			name: 'task-master-ai',
			version: 'unknown'
		});
	});
});
