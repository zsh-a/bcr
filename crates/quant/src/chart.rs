use crate::model::{date_text, valid_date, MAX_INSTRUMENTS, MAX_PARTITION_BYTES};
use arrow_array::{Array, Float64Array, RecordBatch, UInt32Array, UInt64Array, UInt8Array};
use arrow_ipc::reader::StreamReader;
use serde::Serialize;
use std::io::Cursor;

#[derive(Debug, Serialize)]
pub struct SnapshotBar {
    date: String,
    open: f64,
    high: f64,
    low: f64,
    close: f64,
    factor: f64,
    volume: Option<u64>,
    tradable: bool,
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
/** Project one symbol from immutable daily batches without constructing the whole stock universe. */
pub fn snapshot_bars(
    bytes: Vec<u8>,
    instrument: u32,
    from: u32,
    to: u32,
) -> Result<Vec<SnapshotBar>, String> {
    if bytes.is_empty()
        || bytes.len() > MAX_PARTITION_BYTES
        || instrument as usize >= MAX_INSTRUMENTS
    {
        return Err("invalid snapshot partition or instrument".into());
    }
    if !valid_date(from) || !valid_date(to) || from > to {
        return Err("invalid chart date range".into());
    }
    let reader = StreamReader::try_new(Cursor::new(bytes), None).map_err(|e| e.to_string())?;
    let mut output = Vec::new();
    let mut previous = 0;
    for batch in reader {
        let batch = batch.map_err(|e| e.to_string())?;
        if batch.num_rows() == 0 || batch.num_rows() > MAX_INSTRUMENTS {
            return Err("invalid daily batch size".into());
        }
        let dates = column::<UInt32Array>(&batch, "date")?;
        let date = dates.value(0);
        if !valid_date(date) || date <= previous || dates.iter().any(|d| d != Some(date)) {
            return Err("invalid chart calendar".into());
        }
        previous = date;
        if date < from || date > to {
            continue;
        }
        let ids = column::<UInt32Array>(&batch, "id")?;
        if (1..ids.len()).any(|i| ids.value(i) <= ids.value(i - 1)) {
            return Err("duplicate or unsorted chart instruments".into());
        }
        let Some(index) = (0..ids.len()).find(|i| ids.value(*i) == instrument) else {
            continue;
        };
        let price = |name: &str| -> Result<f64, String> {
            let value = column::<Float64Array>(&batch, name)?.value(index);
            if !value.is_finite() || value <= 0.0 || value > 1e12 {
                return Err("invalid chart price".into());
            }
            Ok(value)
        };
        let open = price("open")?;
        let high = price("high")?;
        let low = price("low")?;
        let close = price("close")?;
        let factor = price("adjfactor")?;
        if low > open.min(close) || high < open.max(close) || high * factor > 1e15 {
            return Err("invalid chart OHLC".into());
        }
        let flag = column::<UInt8Array>(&batch, "tradable")?.value(index);
        if flag > 1 {
            return Err("invalid chart tradability".into());
        }
        output.push(SnapshotBar {
            date: date_text(date),
            open,
            high,
            low,
            close,
            factor,
            volume: if batch.column_by_name("volume").is_some() {
                Some(column::<UInt64Array>(&batch, "volume")?.value(index))
            } else {
                None
            },
            tradable: flag == 1,
        });
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    use arrow_array::ArrayRef;
    use arrow_ipc::writer::StreamWriter;
    use std::sync::Arc;

    fn batch(date: u32, duplicate: bool) -> RecordBatch {
        RecordBatch::try_from_iter(vec![
            (
                "date",
                Arc::new(UInt32Array::from(vec![date, date])) as ArrayRef,
            ),
            (
                "id",
                Arc::new(UInt32Array::from(vec![0, if duplicate { 0 } else { 1 }])) as ArrayRef,
            ),
            (
                "open",
                Arc::new(Float64Array::from(vec![10.0, 20.0])) as ArrayRef,
            ),
            (
                "high",
                Arc::new(Float64Array::from(vec![12.0, 22.0])) as ArrayRef,
            ),
            (
                "low",
                Arc::new(Float64Array::from(vec![9.0, 19.0])) as ArrayRef,
            ),
            (
                "close",
                Arc::new(Float64Array::from(vec![11.0, 21.0])) as ArrayRef,
            ),
            (
                "adjfactor",
                Arc::new(Float64Array::from(vec![2.0, 4.0])) as ArrayRef,
            ),
            (
                "tradable",
                Arc::new(UInt8Array::from(vec![1, 0])) as ArrayRef,
            ),
        ])
        .unwrap()
    }
    fn stream(batches: Vec<RecordBatch>) -> Vec<u8> {
        let mut bytes = Vec::new();
        let mut writer = StreamWriter::try_new(&mut bytes, &batches[0].schema()).unwrap();
        for batch in batches {
            writer.write(&batch).unwrap();
        }
        writer.finish().unwrap();
        drop(writer);
        bytes
    }
    #[test]
    fn extracts_one_symbol_and_exact_window_without_fabricating_volume_or_missing_rows() {
        let bytes = stream(vec![batch(20240105, false), batch(20240108, false)]);
        let bars = snapshot_bars(bytes.clone(), 1, 20240108, 20240108).unwrap();
        assert_eq!(bars.len(), 1);
        assert_eq!(bars[0].date, "2024-01-08");
        assert_eq!(
            (bars[0].open, bars[0].close, bars[0].factor),
            (20.0, 21.0, 4.0)
        );
        assert_eq!(bars[0].volume, None);
        assert!(!bars[0].tradable);
        assert!(snapshot_bars(bytes, 2, 20240105, 20240108)
            .unwrap()
            .is_empty());
    }
    #[test]
    fn rejects_invalid_ranges_duplicate_ids_and_unsorted_dates() {
        let bytes = stream(vec![batch(20240108, false)]);
        assert!(snapshot_bars(bytes.clone(), 0, 20240230, 20240301).is_err());
        assert!(snapshot_bars(bytes, 0, 20240108, 20240105).is_err());
        assert!(snapshot_bars(stream(vec![batch(20240108, true)]), 0, 20240105, 20240108).is_err());
        assert!(snapshot_bars(
            stream(vec![batch(20240108, false), batch(20240105, false)]),
            0,
            20240105,
            20240108
        )
        .is_err());
    }
}
