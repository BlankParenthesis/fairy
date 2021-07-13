use napi::{JsObject, JsTypedArray, JsBuffer, JsNumber, Result, CallContext};

use std::collections::HashMap;

use rayon::prelude::*;

type Palette = HashMap<(u8, u8, u8), u8>;

const BYTES_PER_PIXEL: usize = 4;
const TRANSPARENT_PIXEL: u8 = 255;

fn reduce_block(
	block: &Vec<u8>
) -> u8 {
	let mut votes: HashMap<u8, usize> = HashMap::new();

	for value in block {
		if *value != TRANSPARENT_PIXEL {
			votes.insert(
				*value,
				votes.get(value).unwrap_or(&0) + 1
			);
		}
	}

	votes.into_iter()
		.max_by_key(|(_, votes)| *votes)
		.map(|(i, _)| i)
		.unwrap_or(TRANSPARENT_PIXEL)
}

fn into_palette(palette: JsObject) -> Result<Palette> {
	let mut map: Palette = HashMap::new();

	if palette.is_array()? {
		let length = palette.get_array_length()?;

		for i in 0..length {
			let color = palette.get_named_property::<JsObject>(i.to_string().as_str())?;

			let values = color.get_named_property::<JsObject>("values")?;

			if values.is_array()? {
				let r = values.get_named_property::<JsNumber>("0")?.get_uint32()? as u8;
				let g = values.get_named_property::<JsNumber>("1")?.get_uint32()? as u8;
				let b = values.get_named_property::<JsNumber>("2")?.get_uint32()? as u8;

				map.insert((r, g, b), i as u8);
			} else {
				return Err(napi::Error::from_reason(
					String::from("palette color values should be an array")
				))
			}
		}

		Ok(map)
	} else {
		Err(napi::Error::from_reason(String::from("palette should be an array")))
	}
}

#[js_function(3)]
pub fn index(ctx: CallContext) -> Result<JsBuffer> {
	let rgba_buffer = ctx.get::<JsTypedArray>(0)?.into_value()?;
	let rgba_arraybuffer: &[u8] = rgba_buffer.as_ref();
	let palette = into_palette(ctx.get::<JsObject>(1)?)?;
	
	// TODO: index method

	let output = rgba_arraybuffer
		.par_chunks_exact(BYTES_PER_PIXEL)
		.map(|pixel| {
			let a = pixel[3];
			if a > 0 {
				let r = pixel[0];
				let g = pixel[1];
				let b = pixel[2];
				let color = (r, g, b);

				if let Some(index) = palette.get(&color) {
					*index
				} else {
					TRANSPARENT_PIXEL
				}
			} else {
				TRANSPARENT_PIXEL
			}
		})
		.collect::<Vec<u8>>();

	ctx.env.create_buffer_with_data(output)
		.map(|buffer| buffer.into_raw())
}

#[js_function(5)]
pub fn unstylize(ctx: CallContext) -> Result<JsBuffer> {
	let styled_buffer = ctx.get::<JsTypedArray>(0)?.into_value()?;
	let buffer_width = ctx.get::<JsNumber>(1)?.get_uint32()? as usize;
	let _buffer_height = ctx.get::<JsNumber>(2)?.get_uint32()? as usize;
	let block_width = ctx.get::<JsNumber>(3)?.get_uint32()? as usize;
	let block_height = ctx.get::<JsNumber>(4)?.get_uint32()? as usize;
	
	let styled_ref: &[u8] = styled_buffer.as_ref();

	let block_size = block_width * block_height;
	let total_blocks = styled_ref.len() / block_size;
	let blocks_per_row = buffer_width / block_width;

	let mut unstylized_buffer: Vec<u8> = vec![TRANSPARENT_PIXEL; total_blocks];

	let num_threads = num_cpus::get();
	let chunk_size = total_blocks / num_threads + 1;

	unstylized_buffer
		.par_chunks_mut(chunk_size)
		.enumerate()
		.for_each(|(thread_id, blocks)| {
			let blocks_start = thread_id * chunk_size;

			for (i, block) in blocks.iter_mut().enumerate() {
				let block_index = blocks_start + i;

				let block_origin_x = block_index % blocks_per_row;
				let block_origin_y = block_index / blocks_per_row; // floored implicitly
			
				let block_origin_x_offset = block_origin_x * block_width;
				let block_origin_y_offset = block_origin_y * buffer_width * block_height;

				let block_origin = block_origin_y_offset + block_origin_x_offset;

				// skip the first pixel of an image.
				// pxlsfiddle likes putting data here, which messes with our decoder.
				let subblock_start = if block_index == 0 && block_size > 1 { 1 } else { 0 };

				let block_data = (subblock_start..block_size).into_iter()
					.map(|block_subindex| {
						let block_x = block_subindex % block_width;
						let block_y = block_subindex / block_width; // floored implicitly
					
						let block_x_offset = block_x;
						let block_y_offset = block_y * buffer_width;
					
						let block_suboffset = block_y_offset + block_x_offset;
					
						block_origin + block_suboffset
					})
					// TODO: don't panic on incorrect position here
					.map(|position| styled_ref[position])
					.collect::<Vec<u8>>();

				*block = reduce_block(&block_data);
			}
		});

	ctx.env.create_buffer_with_data(unstylized_buffer)
		.map(|buffer| buffer.into_raw())
}
