use super::model::{Bar, MINUTE};

pub fn candles(csv: &str) -> Result<Vec<Bar>, String> {
    if csv.len() > 32 * 1024 * 1024 {
        return Err("trend CSV exceeds 32 MiB".into());
    }
    let mut result: Vec<Bar> = vec![];
    for (index, line) in csv.trim().lines().enumerate() {
        let cells: Vec<_> = line.trim().split(',').collect();
        if index == 0 && cells.first() == Some(&"open_time") {
            continue;
        }
        let fail = || format!("invalid Binance candle at row {}", index + 1);
        if cells.len() < 7 {
            return Err(fail());
        }
        let time: u64 = cells[0].parse().map_err(|_| fail())?;
        let close_time: u64 = cells[6].parse().map_err(|_| fail())?;
        let mut prices = [0.0_f64; 5];
        for (i, p) in prices.iter_mut().enumerate() {
            *p = cells[i + 1].parse().map_err(|_| fail())?;
        }
        let [open, high, low, close, volume] = prices;
        if prices.iter().any(|p| !p.is_finite())
            || !(1_000_000_000_000..100_000_000_000_000).contains(&time)
            || time % MINUTE != 0
            || close_time != time + MINUTE - 1
            || low <= 0.0
            || open <= 0.0
            || close <= 0.0
            || volume < 0.0
            || high < open.max(close)
            || low > open.min(close)
            || result.last().is_some_and(|b| time != b.time + MINUTE)
        {
            return Err(fail());
        }
        result.push(Bar {
            time,
            open,
            high,
            low,
            close,
            volume,
        });
    }
    if result.is_empty() {
        return Err("empty Binance candle partition".into());
    }
    Ok(result)
}
pub fn aligned(candles_csv: &str, marks_csv: &str) -> Result<Vec<(Bar, Bar)>, String> {
    let prices = candles(candles_csv)?;
    let marks = candles(marks_csv)?;
    if prices.len() != marks.len() || prices.iter().zip(&marks).any(|(p, m)| p.time != m.time) {
        return Err("mark candles must exactly align with traded candles".into());
    }
    Ok(prices.into_iter().zip(marks).collect())
}
