#[cfg(not(target_arch = "wasm32"))]
fn run() -> Result<(), bcr_quant::native::Error> {
    use bcr_quant::{
        engine::Engine,
        model::{Config, Manifest},
        native,
    };
    use std::{
        fs::File,
        io::{BufWriter, Write},
        path::Path,
    };
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().is_some_and(|s| s == "inspect") {
        serde_json::to_writer(
            std::io::stdout().lock(),
            &native::ClickHouse::from_env()?.inspect()?,
        )?;
        return Ok(());
    }
    if args.first().is_some_and(|s| s == "export") {
        if args.len() < 4 {
            return Err("usage: jsg export START END OUTPUT [--strict-pit]".into());
        }
        let report = native::export_snapshot(
            &args[1],
            &args[2],
            Path::new(&args[3]),
            args.iter().any(|a| a == "--strict-pit"),
        )?;
        serde_json::to_writer(std::io::stdout().lock(), &report)?;
        return Ok(());
    }
    if args.first().is_some_and(|s| s == "grid") {
        if args.len() < 3 {
            return Err("usage: jsg grid manifest.json configs.json [--threads N]".into());
        }
        let configs: Vec<Config> = serde_json::from_reader(File::open(&args[2])?)?;
        let threads = if let Some(i) = args.iter().position(|a| a == "--threads") {
            args.get(i + 1).ok_or("missing thread count")?.parse()?
        } else {
            std::thread::available_parallelism()?.get().min(8)
        };
        serde_json::to_writer(
            std::io::stdout().lock(),
            &native::grid(Path::new(&args[1]), configs, threads)?,
        )?;
        return Ok(());
    }
    let path = Path::new(
        args.first()
            .ok_or("usage: jsg manifest.json [config.json] [--trace file]")?,
    );
    let manifest: Manifest = serde_json::from_reader(File::open(path)?)?;
    let config: Config = if let Some(path) = args.get(1).filter(|s| !s.starts_with("--")) {
        serde_json::from_reader(File::open(path)?)?
    } else {
        Config::default()
    };
    let mut trace = if let Some(i) = args.iter().position(|a| a == "--trace") {
        Some(BufWriter::new(File::create(
            args.get(i + 1).ok_or("--trace requires a path")?,
        )?))
    } else {
        None
    };
    let jsonl = args.iter().any(|a| a == "--jsonl");
    let mut output = BufWriter::new(std::io::stdout().lock());
    let mut engine = Engine::new(manifest, config)?;
    if jsonl {
        engine.enable_streaming();
    }
    if trace.is_some() {
        engine.enable_audit();
    }
    native::read_snapshot(path, |bars| {
        engine.day(bars)?;
        if let (Some(w), Some(day)) = (&mut trace, engine.take_audit()) {
            serde_json::to_writer(&mut *w, &day)?;
            w.write_all(b"\n")?;
        }
        if jsonl {
            serde_json::to_writer(
                &mut output,
                &serde_json::json!({"kind":"chunk","data":engine.drain_output()}),
            )?;
            output.write_all(b"\n")?;
        }
        Ok(())
    })?;
    if let Some(w) = &mut trace {
        w.flush()?;
    }
    let result = engine.finish()?;
    if jsonl {
        serde_json::to_writer(
            &mut output,
            &serde_json::json!({"kind":"summary","data":result}),
        )?;
        output.write_all(b"\n")?;
    } else {
        serde_json::to_writer(&mut output, &result)?;
    }
    output.flush()?;
    Ok(())
}
fn main() {
    #[cfg(not(target_arch = "wasm32"))]
    if let Err(error) = run() {
        eprintln!("jsg: {error}");
        std::process::exit(1);
    }
}
