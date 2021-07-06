import { PxlsColor } from "pxls";

export async function detemplatize(
	templateImage: Uint8Array,
	imageWidth: number,
	imageHeight: number,
	blockWidth: number,
	blockHeight: number,
	palette: PxlsColor[],
): Buffer;