use super::config::Config;
use super::engine::Engine;
use super::model::{Bar, Chunk, Funding, Metrics};
use super::reader;

/// CSV transport state is separate from the minute engine. Cached partitions may
/// cover a larger interval, but indicator history is fixed by the replay window.
pub(super) struct Replay {
    engine: Engine,
    warmup_start: u64,
    end_time: u64,
    partition: Vec<(Bar, Bar)>,
    cursor: usize,
    source_end: Option<u64>,
}
impl Replay {
    pub fn new(
        config: Config,
        funding: Vec<Funding>,
        start_time: u64,
        end_time: u64,
        warmup_start: u64,
    ) -> Result<Self, String> {
        Ok(Self {
            engine: Engine::new(config, funding, start_time, end_time, warmup_start)?,
            warmup_start,
            end_time,
            partition: vec![],
            cursor: 0,
            source_end: None,
        })
    }

    pub fn load_partition(&mut self, candles: &str, marks: &str) -> Result<(), String> {
        if self.cursor < self.partition.len() {
            return Err("partition still active".into());
        }
        // Validate the entire cached input before clipping it. Invalid or
        // misaligned minutes outside the active interval are not silently hidden.
        let rows = reader::aligned(candles, marks)?;
        let first_time = rows
            .first()
            .expect("reader rejects empty partitions")
            .0
            .time;
        if self.source_end.is_some_and(|end| first_time <= end) {
            return Err("CSV partitions must be chronological and non-overlapping".into());
        }
        self.source_end = rows.last().map(|(bar, _)| bar.time);
        self.partition = rows
            .into_iter()
            .filter(|(bar, _)| bar.time >= self.warmup_start && bar.time < self.end_time)
            .collect();
        self.cursor = 0;
        Ok(())
    }

    pub fn advance(&mut self, rows: u32) -> Result<bool, String> {
        if rows == 0 || rows > 1024 {
            return Err("advance requires 1–1024 rows".into());
        }
        let end = (self.cursor + rows as usize).min(self.partition.len());
        while self.cursor < end {
            let (bar, mark) = self.partition[self.cursor];
            self.engine.advance(bar, mark)?;
            self.cursor += 1;
        }
        Ok(self.cursor == self.partition.len())
    }

    pub fn processed_rows(&self) -> u32 {
        self.engine.rows() as u32
    }

    pub fn drain(&mut self) -> Chunk {
        self.engine.drain()
    }

    pub fn finish(&mut self) -> Result<Metrics, String> {
        if self.cursor != self.partition.len() {
            return Err("partition still active".into());
        }
        self.engine.finish()
    }
}

#[cfg(test)]
mod tests {
    use super::super::model::{DAY, MINUTE};
    use super::*;
    const BASE: u64 = 1_704_067_200_000;

    fn replay() -> Replay {
        let mut config = Config::default();
        config.strategy.trade_minutes = 5;
        config.strategy.filter = "ema".into();
        config.execution.tick_size = 0.001;
        Replay::new(config, vec![], BASE + 2 * DAY, BASE + 3 * DAY, BASE + DAY).unwrap()
    }

    fn history() -> Vec<String> {
        let mut previous: f64 = 100.0;
        (0..4 * 1440)
            .map(|i| {
                let time = BASE + i * MINUTE;
                let close = 100.0 + i as f64 * 0.01 + (i as f64 / 37.0).sin() * 0.2;
                let row = format!(
                    "{time},{previous},{},{},{close},100,{}\n",
                    previous.max(close) + 0.005,
                    previous.min(close) - 0.005,
                    time + MINUTE - 1
                );
                previous = close;
                row
            })
            .collect()
    }

    #[test]
    fn wider_cached_history_and_exact_history_produce_identical_real_replays() {
        let rows = history();
        let run = |partitions: Vec<String>| {
            let mut replay = replay();
            for csv in partitions {
                replay.load_partition(&csv, &csv).unwrap();
                while !replay.advance(512).unwrap() {}
            }
            assert_eq!(replay.processed_rows(), 2 * 1440);
            let metrics = replay.finish().unwrap();
            assert!(metrics.trades > 0, "regression must exercise actual fills");
            serde_json::json!({"metrics": metrics, "output": replay.drain()})
        };
        let exact = run(vec![rows[1440..4320].concat()]);
        assert_eq!(run(vec![rows.concat()]), exact);
        // Also exercise an entirely discarded partition and a boundary inside
        // another partition, as when a wide cached manifest is reused.
        assert_eq!(
            run(rows.chunks(1000).map(|part| part.concat()).collect()),
            exact
        );
    }

    #[test]
    fn cached_rows_are_validated_before_clipping_and_active_gaps_still_fail() {
        let rows = history();
        let mut corrupt = rows.clone();
        corrupt[0] = "invalid outside replay window\n".into();
        assert!(replay()
            .load_partition(&corrupt.concat(), &corrupt.concat())
            .is_err());
        assert!(replay()
            .load_partition(&rows.concat(), &rows[1..].concat())
            .is_err());
        let mut missing = replay();
        missing
            .load_partition(&rows[1441..4320].concat(), &rows[1441..4320].concat())
            .unwrap();
        assert!(missing.advance(512).is_err());
        let mut incomplete = replay();
        let csv = rows[1440..4319].concat();
        incomplete.load_partition(&csv, &csv).unwrap();
        while !incomplete.advance(512).unwrap() {}
        assert!(incomplete.finish().is_err());
    }

    #[test]
    fn clipped_source_partitions_still_reject_duplicates_and_reverse_order() {
        let rows = history();
        let mut replay = replay();
        let discarded = rows[500..1000].concat();
        replay.load_partition(&discarded, &discarded).unwrap();
        assert!(replay.advance(512).unwrap());
        assert_eq!(replay.processed_rows(), 0);
        assert!(replay.load_partition(&discarded, &discarded).is_err());
        let reversed = rows[..500].concat();
        assert!(replay.load_partition(&reversed, &reversed).is_err());

        // Gaps outside the requested interval are harmless; rejected loads must
        // not prevent the next valid, non-overlapping partition from proceeding.
        let exact = rows[1440..4320].concat();
        replay.load_partition(&exact, &exact).unwrap();
        while !replay.advance(512).unwrap() {}
        let future = rows[4500..5000].concat();
        replay.load_partition(&future, &future).unwrap();
        assert!(replay.advance(512).unwrap());
        assert!(replay.load_partition(&future, &future).is_err());
        let reversed_future = rows[4400..4500].concat();
        assert!(replay
            .load_partition(&reversed_future, &reversed_future)
            .is_err());
        assert_eq!(replay.processed_rows(), 2880);
        assert!(replay.finish().is_ok());
    }
}
