//! Shared ClickHouse Arrow normalization; no network or filesystem dependencies.
use crate::{
    model::{valid_date, MAX_INSTRUMENTS, MAX_PARTITION_BYTES},
    reader::decode_day,
};
use arrow_array::{
    Array, ArrayRef, BinaryArray, LargeStringArray, RecordBatch, StringArray, UInt32Array,
};
use arrow_ipc::{reader::StreamReader, writer::StreamWriter};
use arrow_select::concat::concat_batches;
use std::{collections::BTreeMap, io::Cursor, sync::Arc};

pub type Error = Box<dyn std::error::Error + Send + Sync>;
pub const SNAPSHOT_SQL: &str = include_str!("../sql/snapshot.sql");
pub const HISTORICAL_SQL: &str = include_str!("../sql/historical.sql");

/// Each bounded response may split days across IPC batches. Reassemble before replay.
pub(crate) fn normalize_partition(
    bytes: Vec<u8>,
    expected: &[u32],
    codes: &BTreeMap<String, u32>,
    industries: &BTreeMap<String, u32>,
) -> Result<(Vec<u8>, usize), Error> {
    if bytes.is_empty()
        || bytes.len() > MAX_PARTITION_BYTES
        || expected.is_empty()
        || expected.len() > 20
        || expected.iter().any(|d| !valid_date(*d))
        || expected.windows(2).any(|w| w[0] >= w[1])
    {
        return Err("invalid bounded ClickHouse response/calendar".into());
    }
    let mut writer: Option<StreamWriter<Vec<u8>>> = None;
    let mut chunks: Vec<RecordBatch> = vec![];
    let mut current = 0;
    let mut count = 0;
    let mut next = 0;
    let mut rows = 0;
    let mut write_day = |pieces: &[RecordBatch]| -> Result<(), Error> {
        let day = concat_batches(&pieces[0].schema(), pieces)?;
        let bars = decode_day(&day)?;
        if expected.get(next).copied() != Some(bars[0].date)
            || bars.iter().any(|b| {
                b.date != bars[0].date || b.id >= codes.len() || b.industry >= industries.len()
            })
            || bars.windows(2).any(|w| w[0].id >= w[1].id)
        {
            return Err("ClickHouse daily rows differ from requested calendar/universe".into());
        }
        if writer.is_none() {
            writer = Some(StreamWriter::try_new(Vec::new(), &day.schema())?);
        }
        writer.as_mut().unwrap().write(&day)?;
        if writer.as_ref().unwrap().get_ref().len() > MAX_PARTITION_BYTES {
            return Err("normalized ClickHouse partition exceeds 32 MiB".into());
        }
        rows += bars.len();
        next += 1;
        Ok(())
    };
    for raw in StreamReader::try_new(Cursor::new(bytes), None)? {
        let batch = normalize(&raw?, codes, industries)?;
        let dates = batch
            .column_by_name("date")
            .unwrap()
            .as_any()
            .downcast_ref::<UInt32Array>()
            .ok_or("wrong date type")?;
        if dates.null_count() != 0 {
            return Err("null ClickHouse date".into());
        }
        let mut begin = 0;
        while begin < batch.num_rows() {
            let date = dates.value(begin);
            let mut end = begin + 1;
            while end < batch.num_rows() && dates.value(end) == date {
                end += 1;
            }
            if current != 0 && current != date {
                write_day(&chunks)?;
                chunks.clear();
                count = 0;
            }
            current = date;
            count += end - begin;
            if count > MAX_INSTRUMENTS {
                return Err("oversized ClickHouse day".into());
            }
            chunks.push(batch.slice(begin, end - begin));
            begin = end;
        }
    }
    if !chunks.is_empty() {
        write_day(&chunks)?;
    }
    drop(write_day);
    if next != expected.len() {
        return Err("missing ClickHouse trading days".into());
    }
    let mut writer = writer.ok_or("empty ClickHouse response")?;
    writer.finish()?;
    let output = writer.into_inner()?;
    if output.len() > MAX_PARTITION_BYTES {
        return Err("normalized partition exceeds 32 MiB".into());
    }
    Ok((output, rows))
}

fn string_value(array: &ArrayRef, index: usize) -> Result<&str, Error> {
    if array.is_null(index) {
        return Err("null dictionary value".into());
    }
    if let Some(a) = array.as_any().downcast_ref::<StringArray>() {
        return Ok(a.value(index));
    }
    if let Some(a) = array.as_any().downcast_ref::<LargeStringArray>() {
        return Ok(a.value(index));
    }
    if let Some(a) = array.as_any().downcast_ref::<BinaryArray>() {
        return Ok(std::str::from_utf8(a.value(index))?);
    }
    Err("ClickHouse code/industry must be Arrow UTF8/Binary".into())
}
pub(crate) fn normalize(
    batch: &RecordBatch,
    codes: &BTreeMap<String, u32>,
    industries: &BTreeMap<String, u32>,
) -> Result<RecordBatch, Error> {
    let code = batch.column_by_name("code").ok_or("missing code")?;
    let industry = batch
        .column_by_name("industry_code")
        .ok_or("missing industry")?;
    let ids: Vec<u32> = (0..batch.num_rows())
        .map(|i| {
            let c = string_value(code, i)?;
            codes
                .get(c)
                .copied()
                .ok_or_else(|| "unknown instrument".into())
        })
        .collect::<Result<_, Error>>()?;
    let sectors: Vec<u32> = (0..batch.num_rows())
        .map(|i| {
            let c = string_value(industry, i)?;
            industries
                .get(c)
                .copied()
                .ok_or_else(|| "unknown industry".into())
        })
        .collect::<Result<_, Error>>()?;
    let mut arrays: Vec<ArrayRef> = vec![];
    for name in [
        "date",
        "id",
        "industry",
        "open",
        "high",
        "low",
        "close",
        "preclose",
        "adjfactor",
        "profit",
        "shares",
        "is_st",
        "tradable",
        "breadth_member",
        "selection_member",
    ] {
        let array: ArrayRef = match name {
            "id" => Arc::new(UInt32Array::from(ids.clone())),
            "industry" => Arc::new(UInt32Array::from(sectors.clone())),
            _ => batch.column_by_name(name).ok_or("missing feature")?.clone(),
        };
        arrays.push(array);
    }
    let mut names = vec![
        "date",
        "id",
        "industry",
        "open",
        "high",
        "low",
        "close",
        "preclose",
        "adjfactor",
        "profit",
        "shares",
        "is_st",
        "tradable",
        "breadth_member",
        "selection_member",
    ];
    for name in ["volume", "limit_up", "limit_down"] {
        if let Some(a) = batch.column_by_name(name) {
            names.push(name);
            arrays.push(a.clone());
        }
    }
    let schema = arrow_array::RecordBatch::try_from_iter(names.into_iter().zip(arrays))?;
    Ok(schema)
}
