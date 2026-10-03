/**
 * Pure optical-flow helpers for the on-device VIO-lite prototype.
 *
 * No DOM/browser APIs here so the same code can be unit-tested in Node and
 * imported by the browser page. It works on small grayscale frames
 * (e.g. 160x120) and uses dense block matching, which is cheap enough to run
 * at 15-30 fps on a phone.
 */

/** Converts RGBA image data to a grayscale array (0-255). */
export function toGray(rgba, width, height) {
	const out = new Uint8ClampedArray(width * height);
	for (let i = 0; i < out.length; i++) {
		const j = i * 4;
		out[i] = (rgba[j] * 0.299 + rgba[j + 1] * 0.587 + rgba[j + 2] * 0.114) | 0;
	}
	return out;
}

/** Downsamples a grayscale frame to a smaller grid with box averaging. */
export function downsampleGray(gray, width, height, outWidth, outHeight) {
	const out = new Uint8ClampedArray(outWidth * outHeight);
	const sx = width / outWidth;
	const sy = height / outHeight;
	for (let y = 0; y < outHeight; y++) {
		for (let x = 0; x < outWidth; x++) {
			let sum = 0;
			let count = 0;
			const x0 = Math.floor(x * sx);
			const y0 = Math.floor(y * sy);
			const x1 = Math.min(width, Math.max(x0 + 1, Math.floor((x + 1) * sx)));
			const y1 = Math.min(height, Math.max(y0 + 1, Math.floor((y + 1) * sy)));
			for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { sum += gray[yy * width + xx]; count++; }
			out[y * outWidth + x] = count ? (sum / count) | 0 : 0;
		}
	}
	return out;
}

/**
 * Block-matching flow: for each block on a grid, find the integer shift with the
 * lowest sum of absolute differences within a search radius.
 * Returns [{ x, y, dx, dy, sad }] where dx/dy is how far that block moved.
 */
export function blockFlow(prev, cur, width, height, options = {}) {
	const block = options.block ?? 16;
	const step = options.step ?? 12;
	const search = options.search ?? 6;
	const minSad = options.minSad ?? 40;
	const vectors = [];
	for (let by = 0; by + block <= height; by += step) {
		for (let bx = 0; bx + block <= width; bx += step) {
			let bestDx = 0;
			let bestDy = 0;
			let bestSad = Infinity;
			for (let dy = -search; dy <= search; dy++) {
				for (let dx = -search; dx <= search; dx++) {
					const cx = bx + dx;
					const cy = by + dy;
					if (cx < 0 || cy < 0 || cx + block > width || cy + block > height) continue;
					let sad = 0;
					for (let y = 0; y < block; y += 2) {
						const pRow = (by + y) * width + bx;
						const cRow = (cy + y) * width + cx;
						for (let x = 0; x < block; x += 2) sad += Math.abs(prev[pRow + x] - cur[cRow + x]);
					}
					if (sad < bestSad) { bestSad = sad; bestDx = dx; bestDy = dy; }
				}
			}
			// Only keep confident matches (a still block has near-zero SAD).
			const samples = (block / 2) * (block / 2);
			if (bestSad / samples <= minSad) vectors.push({ x: bx + block / 2, y: by + block / 2, dx: bestDx, dy: bestDy, sad: bestSad / samples });
		}
	}
	return vectors;
}

/** Median of a numeric array. */
function median(values) {
	if (!values.length) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Summarizes a flow field into:
 *  - globalDx/Dy: median shift (dominated by rotation and lateral translation),
 *  - expansion: how much the field expands away from the center (forward/back),
 *  - coherent: fraction of blocks agreeing with the median shift,
 *  - fracAtEdge: fraction of blocks whose best match sat at the search border
 *    (a sign the real motion is larger than the search radius),
 *  - sad: median match error (low = truly still, high = blur/low texture).
 */
export function summarizeFlow(vectors, width, height, search = 6) {
	if (vectors.length === 0) return { globalDx: 0, globalDy: 0, expansion: 0, coherent: 0, fracAtEdge: 0, sad: 0, count: 0 };
	const globalDx = median(vectors.map((v) => v.dx));
	const globalDy = median(vectors.map((v) => v.dy));
	const cx = width / 2;
	const cy = height / 2;
	let expansion = 0;
	for (const v of vectors) {
		const rx = v.x - cx;
		const ry = v.y - cy;
		const r = Math.hypot(rx, ry) || 1;
		expansion += (v.dx * rx + v.dy * ry) / r;
	}
	expansion /= vectors.length;
	const coherent = vectors.filter((v) => Math.hypot(v.dx - globalDx, v.dy - globalDy) <= 2).length / vectors.length;
	const edge = search - 0.5;
	const fracAtEdge = vectors.filter((v) => Math.abs(v.dx) >= edge || Math.abs(v.dy) >= edge).length / vectors.length;
	const sad = median(vectors.map((v) => v.sad));
	return { globalDx, globalDy, expansion, coherent, fracAtEdge, sad, count: vectors.length };
}

/** Variance of a grayscale frame; low values mean the scene lacks texture (blur/blank wall). */
export function grayVariance(gray) {
	let sum = 0;
	let sum2 = 0;
	for (let i = 0; i < gray.length; i++) { sum += gray[i]; sum2 += gray[i] * gray[i]; }
	const n = gray.length || 1;
	const mean = sum / n;
	return sum2 / n - mean * mean;
}
