extern crate napi;
extern crate num_traits;

use std::convert::TryInto;

use napi::*;

pub trait AlignPerfectly {
	fn align_perfectly<U>(&self) -> &[U];
}

impl <T>AlignPerfectly for &[T] where T: num_traits::Num {
	fn align_perfectly<U>(&self) -> &[U] {
		// may cause alignment issues on differently-endianed systems
		let (head, body, tail) = unsafe { self.align_to::<U>() };

		assert!(head.is_empty());
		assert!(tail.is_empty());

		body
	}
}

impl <T>AlignPerfectly for Vec<T> where T: num_traits::Num {
	fn align_perfectly<U>(&self) -> &[U] {
		// may cause alignment issues on differently-endianed systems
		let (head, body, tail) = unsafe { self.align_to::<U>() };

		assert!(head.is_empty());
		assert!(tail.is_empty());

		body
	}
}

impl AlignPerfectly for JsArrayBufferValue {
	fn align_perfectly<U>(&self) -> &[U] {
		// may cause alignment issues on differently-endianed systems
		let (head, body, tail) = unsafe { self.align_to::<U>() };

		assert!(head.is_empty());
		assert!(tail.is_empty());

		body
	}
}

macro_rules! index_of {
	( $iterator:expr, $condition:expr) => {
		{
			$iterator
				.iter()
				.enumerate()
				.filter($condition)
				.map(|(i, _)| i as u32)
				.collect::<Vec<u32>>()
		}
    };
}

macro_rules! compare {
	( $a:expr, $b:expr, f32) => {
		(**$a - **$b).abs() > f32::EPSILON
    };
	( $a:expr, $b:expr, f64) => {
		(**$a - **$b).abs() > f64::EPSILON
    };
	( $a:expr, $b:expr, $t:ident) => {
		$a != $b
    };
}

macro_rules! indexed_diff {
	( $a:expr, $b:expr, $t:ident ) => {
		index_of!(
			$a.align_perfectly::<$t>()
				.iter()
				.zip($b.align_perfectly::<$t>())
				.collect::<Vec<_>>(),
			|(_, (a, b))| compare!(a, b, $t)
		)
	}
}

#[js_function(2)]
pub fn indexed_diff(context: CallContext) -> Result<JsTypedArray> {
	let a_buffer = context.get::<JsTypedArray>(0)?.into_value()?;
	let b_buffer = context.get::<JsTypedArray>(1)?.into_value()?;

	let a_arraybuffer = a_buffer.arraybuffer.into_value().unwrap();
	let b_arraybuffer = b_buffer.arraybuffer.into_value().unwrap();

	assert_eq!(a_buffer.typedarray_type, b_buffer.typedarray_type);
	assert_eq!(a_buffer.length, b_buffer.length);

	let indexed_diff = match a_buffer.typedarray_type {
		TypedArrayType::Int8 => indexed_diff!(a_arraybuffer, b_arraybuffer, i8),
		TypedArrayType::Uint8 => indexed_diff!(a_arraybuffer, b_arraybuffer, u8),
		TypedArrayType::Int16 => indexed_diff!(a_arraybuffer, b_arraybuffer, i16),
		TypedArrayType::Uint16 => indexed_diff!(a_arraybuffer, b_arraybuffer, u16),
		TypedArrayType::Int32 => indexed_diff!(a_arraybuffer, b_arraybuffer, i32),
		TypedArrayType::Uint32 => indexed_diff!(a_arraybuffer, b_arraybuffer, u32),
		TypedArrayType::Float32 => indexed_diff!(a_arraybuffer, b_arraybuffer, f32),
		TypedArrayType::Float64 => indexed_diff!(a_arraybuffer, b_arraybuffer, f64),
		_ => unimplemented!()
	};

	let arraybuffer = context.env.create_arraybuffer_with_data(
		indexed_diff.align_perfectly::<u8>().to_vec()
	)?.into_raw();

	arraybuffer.into_typedarray(TypedArrayType::Uint32, indexed_diff.len(), 0)
}


macro_rules! map_array {
	( $iterable:expr, $map:expr, $t:ident) => {
		$iterable.align_perfectly::<$t>()
			.into_iter()
			.map($map)
			.collect::<Vec<$t>>()
    };
}

macro_rules! map_array_array {
	( $a:expr, $b:expr, $map:expr, $t:ident) => {
		$a.align_perfectly::<$t>()
			.iter()
			.zip($b.align_perfectly::<$t>())
			.into_iter()
			.map($map)
			.collect::<Vec<$t>>()
    };
}

macro_rules! add_const {
	( $iterable:expr, $value:expr, $t:ident) => {
		{
			let add = $value as $t;
			map_array!($iterable, |v| v + add, $t)
		}
	}
}

macro_rules! add_array {
	( $a:expr, $b:expr, $t:ident) => {
		map_array_array!($a, $b, |(a, b)| a + b, $t)
    };
}

macro_rules! vec_to_arraybuffer {
	( $context:expr, $vec:expr ) => {
		$context.env.create_arraybuffer_with_data(
			$vec.align_perfectly::<u8>().to_vec()
		)?.into_raw()
	}
}

fn add_const(context: &CallContext, buffer: JsTypedArrayValue, number: &JsNumber) -> Result<JsTypedArray> {
	let arraybuffer = buffer.arraybuffer.into_value()?;
	
	let added_arraybuffer = match buffer.typedarray_type {
		TypedArrayType::Int8 => vec_to_arraybuffer!(context, add_const!(arraybuffer, number.get_int32()?, i8)),
		TypedArrayType::Uint8 => vec_to_arraybuffer!(context, add_const!(arraybuffer, number.get_uint32()?, u8)),
		TypedArrayType::Int16 => vec_to_arraybuffer!(context, add_const!(arraybuffer, number.get_int32()?, i16)),
		TypedArrayType::Uint16 => vec_to_arraybuffer!(context, add_const!(arraybuffer, number.get_uint32()?, u16)),
		TypedArrayType::Int32 => vec_to_arraybuffer!(context, add_const!(arraybuffer, number.get_int32()?, i32)),
		TypedArrayType::Uint32 => vec_to_arraybuffer!(context, add_const!(arraybuffer, number.get_uint32()?, u32)),
		TypedArrayType::Float32 => vec_to_arraybuffer!(context, add_const!(arraybuffer, number.get_double()?, f32)),
		TypedArrayType::Float64 => vec_to_arraybuffer!(context, add_const!(arraybuffer, number.get_double()?, f64)),
		_ => unimplemented!()
	};

	added_arraybuffer.into_typedarray(buffer.typedarray_type, buffer.length as usize, 0)
}

fn add_array(context: &CallContext, a: JsTypedArrayValue, b: JsTypedArrayValue) -> Result<JsTypedArray> {
	assert_eq!(a.typedarray_type, b.typedarray_type);
	assert_eq!(a.length, b.length);

	let a_arraybuffer = a.arraybuffer.into_value()?;
	let b_arraybuffer = b.arraybuffer.into_value()?;

	let added_arraybuffer = match a.typedarray_type {
		TypedArrayType::Int8 => vec_to_arraybuffer!(context, add_array!(a_arraybuffer, b_arraybuffer, i8)),
		TypedArrayType::Uint8 => vec_to_arraybuffer!(context, add_array!(a_arraybuffer, b_arraybuffer, u8)),
		TypedArrayType::Int16 => vec_to_arraybuffer!(context, add_array!(a_arraybuffer, b_arraybuffer, i16)),
		TypedArrayType::Uint16 => vec_to_arraybuffer!(context, add_array!(a_arraybuffer, b_arraybuffer, u16)),
		TypedArrayType::Int32 => vec_to_arraybuffer!(context, add_array!(a_arraybuffer, b_arraybuffer, i32)),
		TypedArrayType::Uint32 => vec_to_arraybuffer!(context, add_array!(a_arraybuffer, b_arraybuffer, u32)),
		TypedArrayType::Float32 => vec_to_arraybuffer!(context, add_array!(a_arraybuffer, b_arraybuffer, f32)),
		TypedArrayType::Float64 => vec_to_arraybuffer!(context, add_array!(a_arraybuffer, b_arraybuffer, f64)),
		_ => unimplemented!()
	};

	added_arraybuffer.into_typedarray(a.typedarray_type, a.length as usize, 0)
}

#[js_function(2)]
pub fn add(context: CallContext) -> Result<JsTypedArray> {
	let buffer = context.get::<JsTypedArray>(0)?.into_value()?;

	if let Ok(number) = context.get::<JsUnknown>(1)?.try_into() {
		add_const(&context, buffer, &number)
	} else if let Ok(second_buffer) = TryInto::<JsTypedArray>::try_into(context.get::<JsUnknown>(1)?) {
		add_array(&context, buffer, second_buffer.into_value()?)
	} else {
		Err(napi::Error::from_status(Status::InvalidArg))
	}
}

macro_rules! multiply_const {
	( $iterable:expr, $value:expr, $t:ident) => {
		{
			let multiply = $value as $t;
			map_array!($iterable, |v| v * multiply, $t)
		}
	}
}

macro_rules! multiply_array {
	( $a:expr, $b:expr, $t:ident) => {
		map_array_array!($a, $b, |(a, b)| a * b, $t)
    };
}

fn multiply_const(context: &CallContext, buffer: JsTypedArrayValue, number: &JsNumber) -> Result<JsTypedArray> {
	let arraybuffer = buffer.arraybuffer.into_value()?;
	
	let added_arraybuffer = match buffer.typedarray_type {
		TypedArrayType::Int8 => vec_to_arraybuffer!(context, multiply_const!(arraybuffer, number.get_int32()?, i8)),
		TypedArrayType::Uint8 => vec_to_arraybuffer!(context, multiply_const!(arraybuffer, number.get_uint32()?, u8)),
		TypedArrayType::Int16 => vec_to_arraybuffer!(context, multiply_const!(arraybuffer, number.get_int32()?, i16)),
		TypedArrayType::Uint16 => vec_to_arraybuffer!(context, multiply_const!(arraybuffer, number.get_uint32()?, u16)),
		TypedArrayType::Int32 => vec_to_arraybuffer!(context, multiply_const!(arraybuffer, number.get_int32()?, i32)),
		TypedArrayType::Uint32 => vec_to_arraybuffer!(context, multiply_const!(arraybuffer, number.get_uint32()?, u32)),
		TypedArrayType::Float32 => vec_to_arraybuffer!(context, multiply_const!(arraybuffer, number.get_double()?, f32)),
		TypedArrayType::Float64 => vec_to_arraybuffer!(context, multiply_const!(arraybuffer, number.get_double()?, f64)),
		_ => unimplemented!()
	};

	added_arraybuffer.into_typedarray(buffer.typedarray_type, buffer.length as usize, 0)
}

fn multiply_array(context: &CallContext, a: JsTypedArrayValue, b: JsTypedArrayValue) -> Result<JsTypedArray> {
	assert_eq!(a.typedarray_type, b.typedarray_type);
	assert_eq!(a.length, b.length);

	let a_arraybuffer = a.arraybuffer.into_value()?;
	let b_arraybuffer = b.arraybuffer.into_value()?;

	let added_arraybuffer = match a.typedarray_type {
		TypedArrayType::Int8 => vec_to_arraybuffer!(context, multiply_array!(a_arraybuffer, b_arraybuffer, i8)),
		TypedArrayType::Uint8 => vec_to_arraybuffer!(context, multiply_array!(a_arraybuffer, b_arraybuffer, u8)),
		TypedArrayType::Int16 => vec_to_arraybuffer!(context, multiply_array!(a_arraybuffer, b_arraybuffer, i16)),
		TypedArrayType::Uint16 => vec_to_arraybuffer!(context, multiply_array!(a_arraybuffer, b_arraybuffer, u16)),
		TypedArrayType::Int32 => vec_to_arraybuffer!(context, multiply_array!(a_arraybuffer, b_arraybuffer, i32)),
		TypedArrayType::Uint32 => vec_to_arraybuffer!(context, multiply_array!(a_arraybuffer, b_arraybuffer, u32)),
		TypedArrayType::Float32 => vec_to_arraybuffer!(context, multiply_array!(a_arraybuffer, b_arraybuffer, f32)),
		TypedArrayType::Float64 => vec_to_arraybuffer!(context, multiply_array!(a_arraybuffer, b_arraybuffer, f64)),
		_ => unimplemented!()
	};

	added_arraybuffer.into_typedarray(a.typedarray_type, a.length as usize, 0)
}

#[js_function(2)]
pub fn multiply(context: CallContext) -> Result<JsTypedArray> {
	let buffer = context.get::<JsTypedArray>(0)?.into_value()?;

	if let Ok(number) = context.get::<JsUnknown>(1)?.try_into() {
		multiply_const(&context, buffer, &number)
	} else if let Ok(second_buffer) = TryInto::<JsTypedArray>::try_into(context.get::<JsUnknown>(1)?) {
		multiply_array(&context, buffer, second_buffer.into_value()?)
	} else {
		Err(napi::Error::from_status(Status::InvalidArg))
	}
}

macro_rules! mask {
	( $a:expr, $mask:expr, $t:ident) => {
		{
			let zero = 0 as $t;
			map_array_array!($a, $mask, |(a, b)| if *b > zero as $t { *a } else { zero }, $t)
		}
    };
}

#[js_function(2)]
pub fn mask(context: CallContext) -> Result<JsTypedArray> {
	let a = context.get::<JsTypedArray>(0)?.into_value()?;
	let b = context.get::<JsTypedArray>(1)?.into_value()?;

	assert_eq!(a.typedarray_type, b.typedarray_type);
	assert_eq!(a.length, b.length);

	let a_arraybuffer = a.arraybuffer.into_value()?;
	let b_arraybuffer = b.arraybuffer.into_value()?;

	let added_arraybuffer = match a.typedarray_type {
		TypedArrayType::Int8 => vec_to_arraybuffer!(context, mask!(a_arraybuffer, b_arraybuffer, i8)),
		TypedArrayType::Uint8 => vec_to_arraybuffer!(context, mask!(a_arraybuffer, b_arraybuffer, u8)),
		TypedArrayType::Int16 => vec_to_arraybuffer!(context, mask!(a_arraybuffer, b_arraybuffer, i16)),
		TypedArrayType::Uint16 => vec_to_arraybuffer!(context, mask!(a_arraybuffer, b_arraybuffer, u16)),
		TypedArrayType::Int32 => vec_to_arraybuffer!(context, mask!(a_arraybuffer, b_arraybuffer, i32)),
		TypedArrayType::Uint32 => vec_to_arraybuffer!(context, mask!(a_arraybuffer, b_arraybuffer, u32)),
		TypedArrayType::Float32 => vec_to_arraybuffer!(context, mask!(a_arraybuffer, b_arraybuffer, f32)),
		TypedArrayType::Float64 => vec_to_arraybuffer!(context, mask!(a_arraybuffer, b_arraybuffer, f64)),
		_ => unimplemented!()
	};

	added_arraybuffer.into_typedarray(a.typedarray_type, a.length as usize, 0)
}


