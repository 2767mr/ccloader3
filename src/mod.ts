import { SemVer, Range as SemVerRange } from '../common/vendor-libs/semver.js';
import { Manifest, ModId } from './types/manifest';
// TODO: consider using `import * as cls` here
import { ModClass, ModDependency, ModLoadingStage, Mod as ModPublic } from './types/mod';
import * as paths from '../common/dist/paths.js';
import { PLATFORM_TYPE, PlatformType, errorHasMessage } from '../common/dist/utils.js';
import * as files from './files.js';

export class Mod implements ModPublic {
	public readonly version: SemVer;
	public readonly dependencies: ReadonlyMap<ModId, ModDependency>;
	public readonly assetsDir: string;
	public assets: Set<string> = new Set();
	public shouldBeLoaded = true;
	public classInstance: ModClass | null = null;

	public constructor(public readonly baseDirectory: string, public readonly manifest: Manifest, public readonly legacyMode: boolean) {
		try {
			this.version = new SemVer(manifest.version);
		} catch (err) {
			if (errorHasMessage(err)) {
				// TODO: put a link to semver docs here
				err.message = `mod version '${manifest.version}' is not a valid semver version: ${err.message}`;
			}
			throw err;
		}

		const dependencies = new Map<ModId, ModDependency>();

		if (manifest.dependencies != null) {
			for (const depId of Object.keys(manifest.dependencies)) {
				let dep = manifest.dependencies[depId];
				if (typeof dep === 'string') {
					dep = { version: dep };
				}

				let depVersionRange: SemVerRange;
				try {
					depVersionRange = new SemVerRange(dep.version);
				} catch (err) {
					if (errorHasMessage(err)) {
						err.message = `dependency version constraint '${dep.version}' for mod '${depId}' is not a valid semver range: ${err.message}`;
					}
					throw err;
				}

				dependencies.set(depId, {
					version: depVersionRange,
					optional: dep.optional ?? false,
				});
			}
		}

		this.dependencies = dependencies;

		this.assetsDir = this.resolvePath(`${this.manifest.assetsDir ?? 'assets'}/`);
	}

	public async findAllAssets(): Promise<void> {
		let assets: string[] = [];
		if (this.manifest.assets != null) {
			assets = this.manifest.assets.map((path) => paths.stripRoot(paths.join('/', path)));
		} else if (PLATFORM_TYPE === PlatformType.Desktop) {
			assets = await files.findRecursively(this.assetsDir);
		}
		this.assets = new Set(assets);
	}

	public async initClass(): Promise<void> {
		const script = this.manifest.main;
		if (script == null) {
			return;
		}
		const scriptFullPath = this.resolvePath(script);

		let modModule: { default: new (mod: Mod) => ModClass };
		try {
			modModule = await import(`/${scriptFullPath}`);
		} catch (err) {
			if (errorHasMessage(err)) {
				err.message = `Error when importing '${scriptFullPath}': ${err.message}`;
			}
			throw err;
		}

		if (!('default' in modModule)) {
			throw new Error(`Module '${scriptFullPath}' has no default export`);
		}

		const ModCtor = modModule.default;
		this.classInstance = new ModCtor(this);
	}

	public async executeStage(stage: ModLoadingStage): Promise<void> {
		let classMethodName: keyof ModClass = stage;
		if (this.legacyMode && stage === 'poststart') {
			classMethodName = 'main';
		}
		if (this.classInstance != null && classMethodName in this.classInstance) {
			await this.classInstance[classMethodName]!(this);
		}

		const script = this.manifest[stage];
		if (script == null) {
			return;
		}
		const scriptFullPath = this.resolvePath(script);

		await import(`/${scriptFullPath}`);
	}

	public resolvePath(path: string): string {
		return paths.join(this.baseDirectory, paths.join('/', path));
	}
}
