import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	getTaskMasterVersion,
	resolveTaskMasterPackageJsonPath
} from '../../src/utils/getVersion.js';

const tempDirs = [];

function createTempDir() {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-get-version-'));
	tempDirs.push(tempDir);
	return tempDir;
}

function writeJson(filePath, data) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

describe('getVersion utility', () => {
	afterEach(() => {
		for (const tempDir of tempDirs.splice(0, tempDirs.length)) {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
		delete process.env.npm_package_version;
	});

	test('getTaskMasterVersion should resolve runtime package version', () => {
		const packageJsonPath = path.join(process.cwd(), 'package.json');
		const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

		expect(getTaskMasterVersion()).toBe(packageJson.version);
	});

	test('resolveTaskMasterPackageJsonPath should find ancestor task-master package', () => {
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

		expect(resolveTaskMasterPackageJsonPath(nestedDir)).toBe(
			path.join(rootDir, 'package.json')
		);
	});

	test('resolveTaskMasterPackageJsonPath should return null when no task-master package is found', () => {
		const nestedDir = path.join(createTempDir(), 'a', 'b', 'c');
		fs.mkdirSync(nestedDir, { recursive: true });

		expect(resolveTaskMasterPackageJsonPath(nestedDir)).toBeNull();
	});
});
