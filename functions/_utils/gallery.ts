export interface ExtensionVersionFile {
	assetType: string;
	source: string;
}

export interface ExtensionVersion {
	version: string;
	lastUpdated: string;
	assetUri: string | null;
	fallbackAssetUri: string | null;
	files: ExtensionVersionFile[];
	properties?: { key: string; value: string }[];
	targetPlatform?: string;
	sha256?: string;
	size?: number;
}

export interface ExtensionIndexEntry {
	extensionId: string;
	extensionName: string;
	displayName: string;
	shortDescription: string;
	publisher: {
		displayName: string;
		publisherId: string;
		publisherName: string;
		domain: string | null;
		isDomainVerified: boolean | null;
	};
	versions: ExtensionVersion[];
	statistics: unknown[];
	tags: string[];
	categories: string[];
	releaseDate: string;
	publishedDate: string;
	lastUpdated: string;
	flags: string;
	identifier: string;
	repository?: string | null;
	homepage?: string | null;
	license?: string | null;
}

export interface IndexFile {
	generatedAt: string;
	source: {
		owner: string;
		prefix: string;
		repositoryCount: number;
	};
	extensions: ExtensionIndexEntry[];
}

export interface ExtensionQueryCriterion {
	filterType: number;
	value?: string;
}

export interface ExtensionQueryFilter {
	pageNumber?: number;
	pageSize?: number;
	criteria?: ExtensionQueryCriterion[];
}

export interface ExtensionQueryBody {
	filters?: ExtensionQueryFilter[];
	flags?: number;
}

const cache = {
	index: null as IndexFile | null,
	etag: null as string | null,
};

export const getCacheEtag = () => cache.etag;

export const jsonResponse = (data: unknown, init: ResponseInit = {}) =>
	new Response(JSON.stringify(data), {
		headers: {
			"content-type": "application/json; charset=utf-8",
			"access-control-allow-origin": "*",
			"access-control-allow-headers": "*",
			"access-control-allow-methods": "GET, POST, OPTIONS",
			...(init.headers ?? {}),
		},
		status: init.status ?? 200,
	});

const buildLookupStrings = (extension: ExtensionIndexEntry) => {
	const unique =
		`${extension.publisher.publisherName}.${extension.extensionName}`.toLowerCase();
	const identifier = extension.identifier?.toLowerCase?.() ?? unique;
	const tags = (extension.tags ?? []).map((tag) => tag.toLowerCase());
	const categories = (extension.categories ?? []).map((category) =>
		category.toLowerCase(),
	);
	return { unique, identifier, tags, categories };
};

const matchesCriterion = (
	extension: ExtensionIndexEntry,
	criterion: ExtensionQueryCriterion,
): boolean => {
	if (!criterion || typeof criterion.value !== "string") return true;
	const value = criterion.value.toLowerCase();
	const lookup = buildLookupStrings(extension);
	switch (criterion.filterType) {
		case 7:
			return (
				extension.extensionName.toLowerCase() === value ||
				lookup.unique === value ||
				lookup.identifier === value
			);
		case 8:
			return value.includes("visualstudio.code");
		case 9:
			return lookup.categories.includes(value);
		case 10: {
			const haystack = [
				extension.extensionName,
				extension.displayName,
				extension.shortDescription,
				...lookup.tags,
				...lookup.categories,
			]
				.filter(Boolean)
				.map((field) => field.toLowerCase());
			return haystack.some((field) => field.includes(value));
		}
		default:
			return true;
	}
};

export const applyFilters = (
	extensions: ExtensionIndexEntry[],
	filters: ExtensionQueryFilter[] | undefined,
): ExtensionIndexEntry[] => {
	if (!filters || filters.length === 0) return extensions;
	let current = extensions;
	for (const filter of filters) {
		const criteria = filter.criteria ?? [];
		if (criteria.length === 0) continue;
		current = current.filter((extension) =>
			criteria.every((criterion) => matchesCriterion(extension, criterion)),
		);
	}
	return current;
};

export const paginate = (
	extensions: ExtensionIndexEntry[],
	filter?: ExtensionQueryFilter,
) => {
	if (!filter) return extensions;
	const size = Math.max(
		1,
		Math.min(filter.pageSize ?? extensions.length, extensions.length),
	);
	const pageNumber = Math.max(1, filter.pageNumber ?? 1);
	const start = (pageNumber - 1) * size;
	return extensions.slice(start, start + size);
};

type AssetsBinding = {
	fetch: (input: RequestInfo, init?: RequestInit) => Promise<Response>;
};

type EnvBindings = Record<string, unknown> & {
	ASSETS?: AssetsBinding;
};

export const loadIndex = async (
	request: Request,
	env: EnvBindings,
): Promise<IndexFile> => {
	if (cache.index) return cache.index;
	const url = new URL("/index.json", request.url);
	if (env?.ASSETS && typeof env.ASSETS.fetch === "function") {
		const response = await env.ASSETS.fetch(url);
		if (!response.ok) {
			throw new Error(`Unable to load index.json (${response.status})`);
		}
		const etag = response.headers.get("etag");
		const json = (await response.json()) as IndexFile;
		cache.index = json;
		cache.etag = etag;
		return json;
	}
	const fallback = await fetch(url.toString());
	if (!fallback.ok) {
		throw new Error(`Unable to load index.json (${fallback.status})`);
	}
	const json = (await fallback.json()) as IndexFile;
	cache.index = json;
	return json;
};

export const sanitizeExtension = (
	extension: ExtensionIndexEntry,
): ExtensionIndexEntry => {
	const versionCopies = extension.versions.map((version) => ({
		version: version.version,
		lastUpdated: version.lastUpdated,
		assetUri: version.assetUri ?? null,
		fallbackAssetUri: version.fallbackAssetUri ?? null,
		files: version.files ?? [],
		properties: version.properties ?? [],
		targetPlatform: version.targetPlatform ?? "universal",
		sha256: version.sha256,
		size: version.size,
	}));

	return {
		extensionId: extension.extensionId,
		extensionName: extension.extensionName,
		displayName: extension.displayName,
		shortDescription: extension.shortDescription,
		publisher: extension.publisher,
		versions: versionCopies,
		statistics: extension.statistics ?? [],
		tags: extension.tags ?? [],
		categories: extension.categories ?? [],
		releaseDate: extension.releaseDate,
		publishedDate: extension.publishedDate,
		lastUpdated: extension.lastUpdated,
		flags: extension.flags ?? "",
		identifier: extension.identifier,
		repository: extension.repository ?? null,
		homepage: extension.homepage ?? null,
		license: extension.license ?? null,
	};
};
