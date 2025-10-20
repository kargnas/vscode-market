import type { PagesFunction } from "@cloudflare/workers-types";
import {
	type ExtensionQueryBody,
	applyFilters,
	getCacheEtag,
	jsonResponse,
	loadIndex,
	paginate,
	sanitizeExtension,
} from "../_utils/gallery";

export const onRequestOptions: PagesFunction = async () =>
	new Response(null, {
		status: 204,
		headers: {
			"access-control-allow-origin": "*",
			"access-control-allow-headers": "*",
			"access-control-allow-methods": "POST, OPTIONS",
		},
	});

export const onRequestPost: PagesFunction = async ({ request, env }) => {
	try {
		const index = await loadIndex(request, env ?? {});
		const body = (await request.json().catch(() => ({}))) as ExtensionQueryBody;
		const filters = body.filters ?? [];
		const filtered = applyFilters(index.extensions, filters);
		const primaryFilter = filters[0];
		const paginated = paginate(filtered, primaryFilter);

		const payload = {
			results: [
				{
					extensions: paginated.map(sanitizeExtension),
					resultMetadata: [
						{
							metadataType: "ResultCount",
							metadataItems: [
								{
									name: "TotalCount",
									count: filtered.length,
								},
							],
						},
					],
				},
			],
		};

		const etag = getCacheEtag();
		return jsonResponse(payload, etag ? { headers: { ETag: etag } } : {});
	} catch (error) {
		console.error("[extensionquery] failed", error);
		return jsonResponse({ message: "Internal Server Error" }, { status: 500 });
	}
};
