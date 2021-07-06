#[macro_use]
extern crate napi_derive;
extern crate napi;
extern crate rayon;
extern crate num_cpus;

use napi::{JsObject, JsTypedArray, JsBuffer, JsNumber, Result, CallContext};

use std::collections::HashMap;

use rayon::prelude::*;

type Palette = HashMap<(u8, u8, u8), u8>;

const BYTES_PER_PIXEL: usize = 4;
const TRANSPARENT_PIXEL: u8 = 255;

fn reduce_block(
	block: &Vec<[u8; 4]>, 
	block_width: usize, 
	block_height: usize, 
	palette: &Palette,
) -> u8 {
	let mut votes = vec![0; palette.len()];

	for y in 0..block_height {
		for x in 0..block_width {
			let i = y * block_width + x;

			let alpha = block[i][3];

			if alpha > 0 {
				let color = (block[i][0], block[i][1], block[i][2]);

				if let Some(index) = palette.get(&color) {
					votes[*index as usize] += 1;
				}
			}
		}
	}

	votes.into_iter()
		.enumerate()
		.filter(|(_, votes)| *votes > 0)
		.max_by_key(|(_, votes)| *votes)
		.map(|(i, _)| i as u8)
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

// TODO: make promise
#[js_function(6)]
fn detemplatize(ctx: CallContext) -> Result<JsBuffer> {
	let buffer_width = ctx.get::<JsNumber>(1)?.get_uint32()? as usize;
	let _buffer_height = ctx.get::<JsNumber>(2)?.get_uint32()? as usize;

	let buffer_real_width = buffer_width * BYTES_PER_PIXEL;

	let block_width = ctx.get::<JsNumber>(3)?.get_uint32()? as usize;
	let block_height = ctx.get::<JsNumber>(4)?.get_uint32()? as usize;

	let block_size = block_width * block_height;

	let block_real_width = block_width * BYTES_PER_PIXEL;

	let blocks_per_row = buffer_width / block_width;

	let styled_template = ctx.get::<JsTypedArray>(0)?.into_value()?;
	let template_ref: &[u8] = styled_template.as_ref();

	let palette = into_palette(ctx.get::<JsObject>(5)?)?;

	let total_blocks = template_ref.len() / (block_size * BYTES_PER_PIXEL);

	let num_threads = num_cpus::get();

	let mut detemplatized_buffer: Vec<u8> = vec![TRANSPARENT_PIXEL; total_blocks];

	let chunk_size = total_blocks / num_threads + 1;

	detemplatized_buffer
		.par_chunks_mut(chunk_size)
		.enumerate()
		.for_each(|(thread_id, blocks)| {
			let blocks_start = thread_id * chunk_size;

			for (i, block) in blocks.iter_mut().enumerate() {
				let block_index = blocks_start + i;

				let block_origin_x = block_index % blocks_per_row;
				let block_origin_y = block_index / blocks_per_row; // floored implicitly
			
				let block_origin_x_offset = block_origin_x * block_real_width;
				let block_origin_y_offset = block_origin_y * buffer_real_width * block_height;

				let block_origin = block_origin_y_offset + block_origin_x_offset;

				let block_data = (0..block_size).into_iter()
					.map(|block_subindex| {
						let block_x = block_subindex % block_width;
						let block_y = block_subindex / block_width; // floored implicitly
					
						let block_x_offset = block_x * BYTES_PER_PIXEL;
						let block_y_offset = block_y * buffer_real_width;
					
						let block_suboffset = block_y_offset + block_x_offset;
					
						block_origin + block_suboffset
					})
					// TODO: don't panic on incorrect position here
					.map(|position| [
						template_ref[position],
						template_ref[position + 1],
						template_ref[position + 2],
						template_ref[position + 3],
					])
					.collect::<Vec<[u8; 4]>>();

				*block = reduce_block(
					&block_data, 
					block_width,
					block_height,
					&palette,
				);
			}
		});

	ctx.env.create_buffer_with_data(detemplatized_buffer)
		.map(|buffer| buffer.into_raw())
}

#[module_exports]
fn init(mut exports: JsObject) -> Result<()> {
	exports.create_named_method("detemplatize", detemplatize)?;
	Ok(())
}
