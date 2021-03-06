// This code is based on the `mod-require-fix` mod:
// https://github.com/CCDirectLink/CCdiscord/blob/8c5dce9653b170ecb4d4a1ba5b170629539c2644/mod-require-fix/preload.js

interface RequireIndex {
	[key: string]: unknown;
}

let requireFixed: NodeRequire;

if (typeof require === 'function') {
	const paths = require('path') as typeof import('path');

	requireFixed = ((id) => {
		try {
			return require(id);
		} catch (_err) {}

		const caller = getCaller();
		const searchPaths = getRequireSearchPaths(caller);
		// this will throw an error if it could not find it
		const pathToId = require.resolve(id, { paths: searchPaths });

		return require(pathToId);
	}) as NodeRequire;

	for (const prop in require) {
		((requireFixed as unknown) as RequireIndex)[prop] = ((require as unknown) as RequireIndex)[prop];
	}

	requireFixed.prototype = { constructor: requireFixed };

	function getRequireSearchPaths(caller: NodeJS.CallSite): string[] {
		const callerFileNameStr: string | null = caller.getFileName();
		if (!callerFileNameStr) {
			return [];
		}

		const callerUrl = new URL(callerFileNameStr);
		let callerPath = callerUrl.pathname;
		if (callerPath.startsWith('/')) {
			callerPath = callerPath.slice(1);
		}
		callerPath = paths.resolve(callerPath);

		// just to avoid an infinite loop
		if (!callerPath.startsWith(process.cwd())) {
			return [];
		}

		const searchPaths = [];
		let currentDirectory;
		let currentPath = callerPath;
		do {
			currentDirectory = paths.dirname(currentPath);
			searchPaths.push(paths.join(currentDirectory, 'node_modules/'));

			currentPath = currentDirectory;
		} while (currentDirectory !== process.cwd());
		// the last pushed entry would be a duplicate
		searchPaths.pop();

		return searchPaths;
	}

	function getCaller(): NodeJS.CallSite {
		let stack: NodeJS.CallSite[];

		// https://v8.dev/docs/stack-trace-api
		// https://stackoverflow.com/a/13227808/12005228
		const err = new Error();
		const originalPrepareStackTrace = Error.prepareStackTrace;
		try {
			Error.prepareStackTrace = function (_err, stack2) {
				return stack2;
			};
			stack = (err.stack as unknown) as NodeJS.CallSite[];
		} finally {
			Error.prepareStackTrace = originalPrepareStackTrace;
		}

		// ignore the call site of this function (from which the mock error has
		// originated) and the one of our caller
		return stack[2];
	}
}

export { requireFixed };
