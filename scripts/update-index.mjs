import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";
import chalk from "chalk";

const OWNER = process.env.GITHUB_OWNER ?? "kargnas";
const PREFIX = process.env.GITHUB_REPO_PREFIX ?? "vscode-ext-";
const API_BASE = process.env.GITHUB_API_BASE ?? "https://api.github.com";
const TOKEN = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null;
const BASE_URL = process.env.MARKET_BASE_URL ?? "";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const EXTENSIONS_DIR = path.join(ROOT, "extensions");
const FILES_DIR = path.join(ROOT, "files");
const TMP_DIR = path.join(ROOT, ".tmp");
const INDEX_PATH = path.join(ROOT, "index.json");

const ensureDirs = async () => {
	await fs.mkdir(EXTENSIONS_DIR, { recursive: true });
	await fs.mkdir(FILES_DIR, { recursive: true });
	await fs.mkdir(TMP_DIR, { recursive: true });
};

const headersBase = {
	"User-Agent": "vscode-market-sync",
	Accept: "application/vnd.github+json",
};

const githubRequest = async (url, init = {}, allowedStatuses = []) => {
	const headers = new Headers(init.headers ?? {});
	for (const [key, value] of Object.entries(headersBase)) {
		if (!headers.has(key)) headers.set(key, value);
	}
	if (TOKEN && !headers.has("Authorization")) {
		headers.set("Authorization", `Bearer ${TOKEN}`);
	}

	const response = await fetch(url, { ...init, headers });
	if (!response.ok && !allowedStatuses.includes(response.status)) {
		const body = await response.text();
		throw new Error(
			`GitHub request failed ${response.status} ${response.statusText} for ${url}: ${body.slice(0, 200)}`,
		);
	}
	return response;
};

const fetchJson = async (url, allowedStatuses = []) => {
	const response = await githubRequest(url, {}, allowedStatuses);
	if (!response.ok) {
		return null;
	}
	return response.json();
};

const fetchRepos = async () => {
	const repos = [];
	let page = 1;
	while (true) {
		const url = `${API_BASE}/users/${OWNER}/repos?per_page=100&page=${page}`;
		const data = await fetchJson(url, [404]);
		if (!data || data.length === 0) break;
		for (const repo of data) {
			if (typeof repo.name === "string" && repo.name.startsWith(PREFIX)) {
				repos.push(repo);
			}
		}
		if (data.length < 100) break;
		page += 1;
	}
	return repos;
};

const pickAsset = (assets = []) => {
	const candidates = assets.filter((asset) => asset.name?.endsWith(".vsix"));
	if (candidates.length === 0) return null;
	const scored = candidates.map((asset) => {
		let score = 0;
		const name = asset.name.toLowerCase();
		if (name.includes("universal")) score += 2;
		if (name.includes("darwin") || name.includes("mac")) score -= 1;
		if (name.includes("win32") || name.includes("win-")) score -= 1;
		return { asset, score };
	});
	scored.sort((a, b) => b.score - a.score);
	return scored[0].asset;
};

const bufferSha256 = (buffer) =>
	createHash("sha256").update(buffer).digest("hex");

const deterministicGuid = (input) => {
	const hex = createHash("sha256").update(input).digest("hex").slice(0, 32);
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};

const entryLookupFactory = (zip) => {
	const entries = zip.getEntries();
	const map = new Map();
	for (const entry of entries) {
		map.set(entry.entryName.toLowerCase(), entry);
	}
	return (name) => map.get(name.toLowerCase()) ?? null;
};

const writeFileIfChanged = async (filepath, data) => {
	const content = Buffer.isBuffer(data) ? data : Buffer.from(data);
	if (existsSync(filepath)) {
		const existing = await fs.readFile(filepath);
		if (existing.equals(content)) return;
	}
	await fs.mkdir(path.dirname(filepath), { recursive: true });
	await fs.writeFile(filepath, content);
};

const loadExistingIndex = async () => {
	if (!existsSync(INDEX_PATH)) return null;
	try {
		const raw = await fs.readFile(INDEX_PATH, "utf-8");
		return JSON.parse(raw);
	} catch (error) {
		console.warn(
			chalk.yellow(
				`Warning: failed to parse existing index.json (${error.message}).`,
			),
		);
		return null;
	}
};

const indexSnapshot = (index) => {
	if (!index) return null;
	return {
		source: index.source,
		extensions: index.extensions,
	};
};

const buildFileUrl = (relativePath) => {
	const clean = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
	if (!BASE_URL) return `/${clean}`;
	return `${BASE_URL.replace(/\/$/, "")}/${clean}`;
};

const toGalleryFiles = (fileList) =>
	fileList.map((file) => ({
		assetType: file.assetType,
		source: buildFileUrl(file.path),
	}));

const processRepository = async (repo) => {
	const releaseUrl = `${API_BASE}/repos/${repo.full_name}/releases/latest`;
	const response = await githubRequest(releaseUrl, {}, [404]);
	if (response.status === 404) {
		console.log(
			chalk.yellow(`- ${repo.name}: latest release not found, skipping.`),
		);
		return null;
	}
	const release = await response.json();
	const asset = pickAsset(release.assets ?? []);
	if (!asset) {
		console.log(
			chalk.yellow(
				`- ${repo.name}: no VSIX asset in latest release, skipping.`,
			),
		);
		return null;
	}

	const downloadUrl =
		asset.browser_download_url ??
		`${API_BASE}/repos/${repo.full_name}/releases/assets/${asset.id}`;
	const tempFile = path.join(TMP_DIR, `${repo.name}-${asset.id}.vsix`);
	let needDownload = true;
	if (existsSync(tempFile)) {
		const stats = await fs.stat(tempFile);
		if (stats.size === asset.size) {
			needDownload = false;
		}
	}
	if (needDownload) {
		console.log(
			chalk.cyan(`  downloading ${asset.name} (${asset.size} bytes)`),
		);
		const downloadResponse = await githubRequest(downloadUrl, {
			headers: {
				Accept: "application/octet-stream",
			},
		});
		const fileHandle = await fs.open(tempFile, "w");
		await pipeline(downloadResponse.body, fileHandle.createWriteStream());
		await fileHandle.close();
	}

	const vsixBuffer = await fs.readFile(tempFile);
	const zip = new AdmZip(vsixBuffer);
	const lookup = entryLookupFactory(zip);
	const packageEntry = lookup("extension/package.json");
	if (!packageEntry) {
		console.log(
			chalk.red(`  ${repo.name}: extension/package.json missing inside VSIX.`),
		);
		return null;
	}
	const packageJson = JSON.parse(packageEntry.getData().toString("utf-8"));
	if (!packageJson.publisher || !packageJson.name || !packageJson.version) {
		console.log(
			chalk.red(`  ${repo.name}: package.json missing publisher/name/version.`),
		);
		return null;
	}
	const identifier = `${packageJson.publisher}.${packageJson.name}`;
	const version = packageJson.version;
	const extensionDir = path.join(EXTENSIONS_DIR, identifier);
	const vsixFilename = `${identifier}-${version}.vsix`;
	const vsixPath = path.join(extensionDir, vsixFilename);
	await fs.mkdir(extensionDir, { recursive: true });
	await writeFileIfChanged(vsixPath, vsixBuffer);

	const filesBase = path.join(FILES_DIR, identifier, version);
	const relativeFilesBase = path.relative(ROOT, filesBase).replace(/\\/g, "/");

	await writeFileIfChanged(
		path.join(filesBase, "package.json"),
		packageEntry.getData(),
	);
	const manifestEntry = lookup("extension.vsixmanifest");
	if (manifestEntry) {
		await writeFileIfChanged(
			path.join(filesBase, "extension.vsixmanifest"),
			manifestEntry.getData(),
		);
	}

	const optionalFiles = [
		{ path: packageJson.readme ?? "extension/README.md", target: "readme.md" },
		{
			path: packageJson.changelog ?? "extension/CHANGELOG.md",
			target: "changelog.md",
		},
		{ path: packageJson.license ?? "extension/LICENSE", target: "license" },
	];

	const extractedOptionals = {};

	for (const optional of optionalFiles) {
		if (!optional.path) continue;
		const entryPath = optional.path.startsWith("extension/")
			? optional.path
			: `extension/${optional.path}`;
		const entry = lookup(entryPath);
		if (!entry) continue;
		await writeFileIfChanged(
			path.join(filesBase, optional.target),
			entry.getData(),
		);
		extractedOptionals[optional.target] = true;
	}

	let iconRelative = null;
	if (packageJson.icon) {
		const iconEntry = lookup(`extension/${packageJson.icon}`);
		if (iconEntry) {
			const ext = path.extname(packageJson.icon) || ".png";
			const iconName = `icon${ext}`;
			await writeFileIfChanged(
				path.join(filesBase, iconName),
				iconEntry.getData(),
			);
			iconRelative = `${relativeFilesBase}/${iconName}`;
		}
	}

	const sha256 = bufferSha256(vsixBuffer);

	const relativeVsixPath = path.relative(ROOT, vsixPath).replace(/\\/g, "/");
	const fileList = [
		{
			assetType: "Microsoft.VisualStudio.Code.Manifest",
			path: `${relativeFilesBase}/extension.vsixmanifest`,
		},
		{
			assetType: "Microsoft.VisualStudio.Services.Content.Details",
			path: `${relativeFilesBase}/package.json`,
		},
		iconRelative
			? {
					assetType: "Microsoft.VisualStudio.Services.Icons.Default",
					path: iconRelative,
				}
			: null,
		extractedOptionals["readme.md"]
			? {
					assetType: "Microsoft.VisualStudio.Services.Content.Details",
					path: `${relativeFilesBase}/readme.md`,
				}
			: null,
		extractedOptionals["changelog.md"]
			? {
					assetType: "Microsoft.VisualStudio.Services.Content.Changelog",
					path: `${relativeFilesBase}/changelog.md`,
				}
			: null,
		extractedOptionals.license
			? {
					assetType: "Microsoft.VisualStudio.Services.Content.License",
					path: `${relativeFilesBase}/license`,
				}
			: null,
		{
			assetType: "Microsoft.VisualStudio.Services.VSIXPackage",
			path: relativeVsixPath,
		},
		{
			assetType: "Microsoft.VisualStudio.Services.VsixManifest",
			path: `${relativeFilesBase}/extension.vsixmanifest`,
		},
	].filter(Boolean);

	const versionEntry = {
		version,
		lastUpdated:
			release.published_at ?? release.created_at ?? new Date().toISOString(),
		assetUri: null,
		fallbackAssetUri: null,
		files: toGalleryFiles(fileList),
		properties: [],
		targetPlatform: "universal",
		sha256,
		size: vsixBuffer.length,
	};

	const extensionEntry = {
		extensionId: deterministicGuid(identifier),
		extensionName: packageJson.name,
		displayName: packageJson.displayName ?? packageJson.name,
		shortDescription: packageJson.description ?? "",
		publisher: {
			displayName: packageJson.publisherDisplayName ?? packageJson.publisher,
			publisherId: deterministicGuid(packageJson.publisher),
			publisherName: packageJson.publisher,
			domain: null,
			isDomainVerified: false,
		},
		versions: [versionEntry],
		statistics: [],
		tags: Array.isArray(packageJson.keywords) ? packageJson.keywords : [],
		categories: Array.isArray(packageJson.categories)
			? packageJson.categories
			: [],
		releaseDate:
			release.created_at ?? release.published_at ?? new Date().toISOString(),
		publishedDate:
			release.published_at ?? release.created_at ?? new Date().toISOString(),
		lastUpdated:
			release.published_at ?? release.created_at ?? new Date().toISOString(),
		flags: "",
		identifier,
		repository:
			packageJson.repository?.url ?? packageJson.repository ?? repo.html_url,
		homepage: packageJson.homepage ?? repo.homepage ?? null,
		license: packageJson.license ?? null,
	};

	return extensionEntry;
};

const cleanupDirs = async (validExtensions) => {
	const validSet = new Set(validExtensions.map((ext) => ext.identifier));
	const extensionFolders = await fs.readdir(EXTENSIONS_DIR).catch(() => []);
	for (const folder of extensionFolders) {
		if (!validSet.has(folder)) {
			await fs.rm(path.join(EXTENSIONS_DIR, folder), {
				recursive: true,
				force: true,
			});
		}
	}
	const filesFolders = await fs.readdir(FILES_DIR).catch(() => []);
	for (const folder of filesFolders) {
		if (!validSet.has(folder)) {
			await fs.rm(path.join(FILES_DIR, folder), {
				recursive: true,
				force: true,
			});
		}
	}
};

const main = async () => {
	await ensureDirs();
	console.log(
		chalk.blue(`Scanning GitHub for ${PREFIX} repositories under ${OWNER}...`),
	);
	const repos = await fetchRepos();
	console.log(chalk.blue(`Found ${repos.length} candidate repositories.`));
	const extensions = [];
	for (const repo of repos) {
		console.log(chalk.green(`Processing ${repo.full_name}...`));
		try {
			const result = await processRepository(repo);
			if (result) {
				extensions.push(result);
			}
		} catch (error) {
			console.error(
				chalk.red(`  Failed to process ${repo.full_name}: ${error.message}`),
			);
		}
	}

	await cleanupDirs(extensions);
	const existingIndex = await loadExistingIndex();

	const index = {
		generatedAt: new Date().toISOString(),
		source: {
			owner: OWNER,
			prefix: PREFIX,
			repositoryCount: repos.length,
		},
		extensions: extensions.sort((a, b) =>
			a.identifier.localeCompare(b.identifier),
		),
	};

	const previousSnapshot = indexSnapshot(existingIndex);
	const nextSnapshot = indexSnapshot(index);
	const hasChanged =
		!previousSnapshot ||
		JSON.stringify(previousSnapshot) !== JSON.stringify(nextSnapshot);

	if (!hasChanged && existingIndex?.generatedAt) {
		index.generatedAt = existingIndex.generatedAt;
	}

	const serialized = `${JSON.stringify(index, null, 2)}\n`;

	if (hasChanged) {
		await fs.writeFile(INDEX_PATH, serialized);
		console.log(
			chalk.blue(
				`index.json updated with ${extensions.length} extensions (changes detected).`,
			),
		);
	} else {
		await writeFileIfChanged(INDEX_PATH, serialized);
		console.log(
			chalk.blue(
				`No catalog changes detected; index.json timestamp preserved (${extensions.length} extensions).`,
			),
		);
	}
};

main().catch((error) => {
	console.error(chalk.red(error.stack ?? error.message));
	process.exitCode = 1;
});
