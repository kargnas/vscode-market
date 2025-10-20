import type { PagesFunction } from "@cloudflare/workers-types";
import { jsonResponse, loadIndex, sanitizeExtension } from "../_utils/gallery";

const normaliseItemName = (value: string) => value.trim().toLowerCase();

export const onRequestGet: PagesFunction = async ({ request, env }) => {
	const url = new URL(request.url);
	const itemName = url.searchParams.get("itemName");
	const versionParam = url.searchParams.get("version");
	if (!itemName) {
		return jsonResponse(
			{ message: "itemName query parameter required" },
			{ status: 400 },
		);
	}

	try {
		const index = await loadIndex(request, env ?? {});
		const normalised = normaliseItemName(itemName);
		const extension = index.extensions.find((candidate) => {
			const unique =
				`${candidate.publisher.publisherName}.${candidate.extensionName}`.toLowerCase();
			return (
				candidate.identifier?.toLowerCase?.() === normalised ||
				unique === normalised ||
				candidate.extensionName.toLowerCase() === normalised
			);
		});

		if (!extension) {
			return jsonResponse(
				{ message: `Extension ${itemName} not found.` },
				{ status: 404 },
			);
		}

		const payload = sanitizeExtension(extension);
		if (versionParam) {
			const version = payload.versions.find(
				(candidate) => candidate.version === versionParam,
			);
			if (!version) {
				return jsonResponse(
					{ message: `Version ${versionParam} not found for ${itemName}.` },
					{ status: 404 },
				);
			}
			return jsonResponse({ extension: payload, version });
		}

		return jsonResponse({ extension: payload });
	} catch (error) {
		console.error("[items] failed", error);
		return jsonResponse({ message: "Internal Server Error" }, { status: 500 });
	}
};
