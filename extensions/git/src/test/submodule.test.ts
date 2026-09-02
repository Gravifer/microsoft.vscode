/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'mocha';
import * as assert from 'assert';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigurationTarget, extensions, Uri, workspace } from 'vscode';
import { GitExtensionImpl } from '../api/extension';
import { RepositoryState } from '../repository';
import { pathEquals } from '../util';

suite('submodule repository names', () => {
	test('creates configured name before parent status publishes submodules', async function () {
		this.timeout(60_000);

		const testRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vscode-git-submodule-name-'));
		const sourceRoot = path.join(testRoot, 'source');
		const superProjectRoot = path.join(testRoot, 'superproject');
		const submoduleRoot = path.join(superProjectRoot, 'dependencies', 'metaprogramming');
		const configuration = workspace.getConfiguration('git');
		const detectSubmodules = configuration.inspect<boolean>('detectSubmodules')?.workspaceValue;

		const git = (cwd: string, ...args: string[]) => {
			cp.execFileSync('git', args, { cwd, stdio: 'pipe' });
		};

		let parentRepository: ReturnType<NonNullable<GitExtensionImpl['model']>['getRepository']>;
		let childRepository: ReturnType<NonNullable<GitExtensionImpl['model']>['getRepository']>;

		try {
			await configuration.update('detectSubmodules', false, ConfigurationTarget.Workspace);

			await fs.promises.mkdir(sourceRoot);
			git(sourceRoot, 'init', '-b', 'main');
			git(sourceRoot, 'config', 'user.name', 'testuser');
			git(sourceRoot, 'config', 'user.email', 'monacotools@example.com');
			git(sourceRoot, 'config', 'commit.gpgsign', 'false');
			await fs.promises.writeFile(path.join(sourceRoot, 'README.md'), '# source\n');
			git(sourceRoot, 'add', '.');
			git(sourceRoot, 'commit', '-m', 'initial commit');

			await fs.promises.mkdir(superProjectRoot);
			git(superProjectRoot, 'init', '-b', 'main');
			git(superProjectRoot, 'config', 'user.name', 'testuser');
			git(superProjectRoot, 'config', 'user.email', 'monacotools@example.com');
			git(superProjectRoot, 'config', 'commit.gpgsign', 'false');
			git(superProjectRoot, '-c', 'protocol.file.allow=always', 'submodule', 'add', '--name', 'mpil', sourceRoot, 'dependencies/metaprogramming');

			const extension = extensions.getExtension<GitExtensionImpl>('vscode.git');
			await extension?.activate();
			const model = extension?.exports.model;
			assert.ok(model);

			await model.openRepository(superProjectRoot, true, true);
			parentRepository = model.repositories.find(repository => pathEquals(repository.root, superProjectRoot));
			assert.ok(parentRepository);
			await parentRepository.status();

			// Simulate the initialization window after the parent is registered but
			// before its initial status publishes the parsed submodule list.
			parentRepository['_submodules'] = [];

			await model.openRepository(submoduleRoot, true);
			childRepository = model.repositories.find(repository => pathEquals(repository.root, submoduleRoot));
			assert.ok(childRepository);

			assert.deepStrictEqual({
				name: childRepository.name,
				kind: childRepository.kind,
				root: childRepository.sourceControl.rootUri?.fsPath,
				parent: childRepository.dotGit.superProjectPath
			}, {
				name: 'mpil',
				kind: 'submodule',
				root: Uri.file(submoduleRoot).fsPath,
				parent: Uri.file(superProjectRoot).fsPath
			});
		} finally {
			if (childRepository) {
				childRepository.state = RepositoryState.Disposed;
			}
			if (parentRepository) {
				parentRepository.state = RepositoryState.Disposed;
			}

			await configuration.update('detectSubmodules', detectSubmodules, ConfigurationTarget.Workspace);
			await fs.promises.rm(testRoot, { recursive: true, force: true });
		}
	});
});
