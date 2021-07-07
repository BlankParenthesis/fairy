import { PxlsColor } from "@blankparenthesis/pxlsspace";

export async function detemplatize(
	templateImage: Uint8Array,
	imageWidth: number,
	imageHeight: number,
	blockWidth: number,
	blockHeight: number,
	palette: PxlsColor[],
): Buffer;

export function diff<T extends NodeJS.TypedArray>(a: T, b: T): Uint32Array;
export function add<T extends NodeJS.TypedArray>(a: T, b: number | T): T;
export function multiply<T extends NodeJS.TypedArray>(a: T, b: number | T): T;
export function mask<T extends NodeJS.TypedArray>(a: T, b: T): T;