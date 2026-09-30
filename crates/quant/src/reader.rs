use crate::model::{Bar, MAX_INSTRUMENTS};
use arrow_array::{Array, Float64Array, RecordBatch, UInt32Array, UInt64Array, UInt8Array};

/// Strict typed protocol. No row objects or Arrow decoding are needed on the JavaScript side.
pub fn decode_day(batch: &RecordBatch) -> Result<Vec<Bar>, String> {
    if batch.num_rows() == 0 || batch.num_rows() > MAX_INSTRUMENTS {
        return Err("invalid daily batch size".into());
    }
    fn column<'a, T: Array + 'static>(batch: &'a RecordBatch, name: &str) -> Result<&'a T, String> {
        let col = batch
            .column_by_name(name)
            .ok_or_else(|| format!("missing Arrow column {name}"))?;
        if col.null_count() != 0 {
            return Err(format!("nulls in Arrow column {name}"));
        }
        col.as_any()
            .downcast_ref::<T>()
            .ok_or_else(|| format!("wrong Arrow type for {name}"))
    }
    let date = column::<UInt32Array>(batch, "date")?;
    let id = column::<UInt32Array>(batch, "id")?;
    let industry = column::<UInt32Array>(batch, "industry")?;
    let open = column::<Float64Array>(batch, "open")?;
    let high = column::<Float64Array>(batch, "high")?;
    let low = column::<Float64Array>(batch, "low")?;
    let close = column::<Float64Array>(batch, "close")?;
    let preclose = column::<Float64Array>(batch, "preclose")?;
    let adjfactor = column::<Float64Array>(batch, "adjfactor")?;
    let profit = column::<Float64Array>(batch, "profit")?;
    let shares = column::<Float64Array>(batch, "shares")?;
    let is_st = column::<UInt8Array>(batch, "is_st")?;
    let tradable = column::<UInt8Array>(batch, "tradable")?;
    let breadth = column::<UInt8Array>(batch, "breadth_member")?;
    let selection = column::<UInt8Array>(batch, "selection_member")?;
    let volume = if batch.column_by_name("volume").is_some() {
        Some(column::<UInt64Array>(batch, "volume")?)
    } else {
        None
    };
    let limit_up = if batch.column_by_name("limit_up").is_some() {
        Some(column::<Float64Array>(batch, "limit_up")?)
    } else {
        None
    };
    let limit_down = if batch.column_by_name("limit_down").is_some() {
        Some(column::<Float64Array>(batch, "limit_down")?)
    } else {
        None
    };
    let mut bars = Vec::with_capacity(batch.num_rows());
    for i in 0..batch.num_rows() {
        if [
            is_st.value(i),
            tradable.value(i),
            breadth.value(i),
            selection.value(i),
        ]
        .iter()
        .any(|v| *v > 1)
        {
            return Err("Arrow flags must be 0 or 1".into());
        }
        bars.push(Bar {
            volume: volume.map(|v| v.value(i)),
            limit_up: limit_up.map(|v| v.value(i)),
            limit_down: limit_down.map(|v| v.value(i)),
            date: date.value(i),
            id: id.value(i) as usize,
            industry: industry.value(i) as usize,
            open: open.value(i),
            high: high.value(i),
            low: low.value(i),
            close: close.value(i),
            preclose: preclose.value(i),
            adjfactor: adjfactor.value(i),
            profit: profit.value(i),
            shares: shares.value(i),
            is_st: is_st.value(i) != 0,
            tradable: tradable.value(i) != 0,
            breadth_member: breadth.value(i) != 0,
            selection_member: selection.value(i) != 0,
        });
    }
    Ok(bars)
}
