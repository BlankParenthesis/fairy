import { URL } from "url";

import fetch from "node-fetch";
import sharp = require("sharp");
import * as is from "check-types";

import config, { FilterType } from "./config";

const MEGABYTE = 10 ** 6;

export const download = async (url: URL) => {
	const urlIsKnown = config.download.filter.domains.includes(url.hostname);
	const wantKnownURL = config.download.filter.type === FilterType.ALLOW;

	if(urlIsKnown !== wantKnownURL) {
		let message = `Untrusted template source “${url.hostname}”`;

		if(config.download.filter.type === FilterType.ALLOW) {
			message += ` (trusted domains: ${config.download.filter.domains.join(", ")})`;
		}

		throw new Error(message);
	}

	return await fetch(url, {
		// full global template, custom symbols: ~~6.7 MB~~ about 10MB (6.7 was webp)
		"size": 16 * MEGABYTE,
	});
};

export const downloadImage = async (url: URL) => {
	const image = await download(url);

	const im = sharp(await image.buffer());
	const meta = await im.metadata();

	if(is.undefined(meta.width)) {
		throw new Error("Image defines no width");
	}
	if(is.undefined(meta.height)) {
		throw new Error("Image defines no height");
	}

	const { width, height } = meta;
	const data = Uint8Array.from(await im.raw().toBuffer());

	return { width, height, data };
};
