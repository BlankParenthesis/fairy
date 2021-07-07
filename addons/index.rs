#[macro_use]
extern crate napi_derive;
extern crate napi;
extern crate rayon;
extern crate num_cpus;
extern crate num_traits;

use napi::{JsObject, Result};

mod detemplatize;
mod buffermath;

#[module_exports]
fn init(mut exports: JsObject) -> Result<()> {
	exports.create_named_method("detemplatize", detemplatize::detemplatize)?;
	exports.create_named_method("diff", buffermath::indexed_diff)?;
	exports.create_named_method("add", buffermath::add)?;
	exports.create_named_method("multiply", buffermath::multiply)?;
	exports.create_named_method("mask", buffermath::mask)?;
	Ok(())
}
