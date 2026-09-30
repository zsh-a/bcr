use arrow_ipc::reader::StreamReader;
use bcr_quant::{
    engine::Engine,
    model::{Config, Manifest, MAX_PARTITION_BYTES},
    reader::decode_day,
};
use std::{fs::File, io::BufReader, path::Path};

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    let manifest_path = args
        .get(1)
        .ok_or("usage: jsg manifest.json [config.json]")?;
    let manifest: Manifest = serde_json::from_reader(File::open(manifest_path)?)?;
    let config = if let Some(path) = args.get(2) {
        serde_json::from_reader(File::open(path)?)?
    } else {
        Config::default()
    };
    let root = Path::new(manifest_path)
        .parent()
        .ok_or("missing dataset directory")?;
    let mut engine = Engine::new(manifest.clone(), config)?;
    for partition in &manifest.partitions {
        let file = File::open(root.join(&partition.file))?;
        let size = file.metadata()?.len() as usize;
        if size != partition.bytes || size > MAX_PARTITION_BYTES {
            return Err("partition byte size mismatch".into());
        }
        let mut rows = 0;
        for batch in StreamReader::try_new(BufReader::new(file), None)? {
            let batch = batch?;
            rows += batch.num_rows();
            engine.day(decode_day(&batch)?)?;
        }
        if rows != partition.rows {
            return Err("partition row count mismatch".into());
        }
    }
    serde_json::to_writer(std::io::stdout().lock(), &engine.finish()?)?;
    Ok(())
}
fn main() {
    if let Err(error) = run() {
        eprintln!("jsg: {error}");
        std::process::exit(1);
    }
}
