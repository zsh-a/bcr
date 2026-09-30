#!/usr/bin/env python3
"""Replay the *actual* quent strategy/broker against frozen daily Arrow input.

--capture records every read-only quent SQL response. Without it, replay is entirely
local and fails for uncaptured queries. Source hashes pin the Python reference.
No strategy translation is used as the reference implementation.
"""
import argparse
import hashlib
import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace
import pyarrow as pa


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''): h.update(chunk)
    return h.hexdigest()


class FrozenQueries:
    def __init__(self, folder, client=None):
        self.folder, self.client = folder, client
        folder.mkdir(parents=True, exist_ok=True)

    def query(self, sql, parameters=None, **kwargs):
        identity = json.dumps([sql, parameters], sort_keys=True, default=str).encode()
        key = hashlib.sha256(identity).hexdigest()
        path = self.folder / (key + '.arrow')
        if path.exists():
            with pa.ipc.open_file(path) as reader: table = reader.read_all()
        else:
            if self.client is None: raise RuntimeError(f'uncaptured reference query: {key}')
            result = self.client.query(sql, parameters=parameters, settings={'readonly': 1})
            table = pa.table({name: [row[i] for row in result.result_rows] for i, name in enumerate(result.column_names)})
            with pa.OSFile(str(path), 'wb') as f:
                with pa.ipc.new_file(f, table.schema) as writer: writer.write_table(table)
            (self.folder / (key + '.json')).write_bytes(identity)
        columns = table.to_pydict()
        return SimpleNamespace(column_names=table.column_names, result_rows=list(zip(*(columns[n] for n in table.column_names))))


def run(args):
    import pandas as pd
    os.environ["LANGFUSE_TRACING_ENABLED"] = "false"
    os.environ["OTEL_SDK_DISABLED"] = "true"
    sys.path.insert(0, str(args.quent.resolve()))
    from loguru import logger
    from src.core.base import Bar
    from src.core.engine import TradingEngine
    from src.core.backtest_broker import BacktestBroker
    from src.market_data.db import DB
    from src.strategies.jsg_strategy import JSGStrategy
    logger.disable('src')
    manifest = json.loads(args.manifest.read_text())
    config = json.loads(args.config.read_text()) if args.config else {
        'initialCapital': 1000000, 'poolSize': 20, 'stockCount': 10,
        'commissionBps': 3, 'slippageBps': 10, 'stopLoss': 0, 'trailingStop': 0, 'maxDrawdown': 0,
    }
    sources = {str(p.relative_to(args.quent)): digest(p) for p in [
        args.quent / 'src/strategies/jsg_strategy.py', args.quent / 'src/core/backtest_broker.py',
        args.quent / 'src/market_data/db.py', args.quent / 'src/core/trading_calendar.py', args.quent / 'src/core/engine.py',
    ]}
    args.output.mkdir(parents=True, exist_ok=True)
    provenance = args.output / 'sources.json'
    if provenance.exists() and json.loads(provenance.read_text()) != sources:
        raise RuntimeError('quent reference changed; create a fresh reconciliation directory')
    frozen_hashes = args.output / 'snapshot-sha256.json'
    if frozen_hashes.exists():
        for name, expected in json.loads(frozen_hashes.read_text()).items():
            candidate = args.output / name if name.startswith('queries/') else args.manifest.parent / name
            if '..' in Path(name).parts or Path(name).is_absolute() or digest(candidate) != expected:
                raise RuntimeError(f'frozen snapshot integrity mismatch: {name}')
    provenance.write_text(json.dumps(sources, indent=2) + '\n')
    client = None
    if args.capture:
        from src.market_data.clickhouse import create_clickhouse_client
        client = create_clickhouse_client()
    db = DB.__new__(DB)
    db.client, db._cache = FrozenQueries(args.output / 'queries', client), {}
    broker = BacktestBroker(initial_cash=config['initialCapital'], commission=config['commissionBps']/10000,
                            slippage=config['slippageBps']/10000, db_client=db)
    strategy = JSGStrategy(db, pool_size=config['poolSize'], stock_sum=config['stockCount'],
                           stop_loss_pct=config['stopLoss'], trailing_stop_pct=config['trailingStop'], max_drawdown_pct=config['maxDrawdown'])
    engine = TradingEngine(strategy, broker, None)
    original_log = strategy._log
    def checked_log(message, *a, **kw):
        if kw.get("level") == "ERROR": raise RuntimeError(message)
        return original_log(message, *a, **kw)
    strategy._log = checked_log
    names = db.client.query('SELECT DISTINCT industry_code, industry_name FROM stock_data.industry_info FINAL').result_rows
    name_to_code = {name: code for code, name in names}
    targets = None
    original_adjust = strategy.adjust
    def observe_adjust(stocks, date):
        nonlocal targets
        targets = stocks[:config['stockCount']]
        return original_adjust(stocks, date)
    strategy.adjust = observe_adjust
    with (args.output / 'python-trace.jsonl').open('w') as trace:
        for partition in manifest['partitions']:
            with pa.ipc.open_stream(args.manifest.parent / partition['file']) as reader:
                for batch in reader:
                    frame = batch.to_pandas()
                    date = str(int(frame.iloc[0]['date']))
                    ts = pd.Timestamp(f'{date[:4]}-{date[4:6]}-{date[6:]}')
                    bars = {}
                    for row in frame.itertuples(index=False):
                        code = manifest['instruments'][row.id]['code']; factor = row.adjfactor
                        bars[code] = Bar(code, ts.to_pydatetime(), row.open*factor, row.high*factor, row.low*factor,
                                         row.close*factor, 0, 0, {'preclose': row.preclose, 'isst': int(row.is_st)})
                    if int(date) < manifest['startDate']:
                        broker.last_prices.update({c:b.close for c,b in bars.items()}); continue
                    start = len(broker.history); targets = None
                    broker.step(bars)
                    engine.current_bars = bars
                    strategy._update_current_date(bars); strategy.on_bar(bars)
                    broker.process_same_bar_orders(bars, 'IMMEDIATE_OPEN')
                    broker.process_same_bar_orders(bars, 'IMMEDIATE_CLOSE')
                    # Observe every industry's ratio using the exact pandas/TA-Lib operations in quent.
                    audit_db = DB.__new__(DB); audit_db.client = db.client; audit_db._cache = {}
                    prices = audit_db.get_price(db.get_index_stocks('000985', str(ts.date())), str(ts.date()), ['close'], 20).copy(deep=True)
                    import talib
                    prices['ma20'] = prices.groupby(level='code')['close'].transform(lambda x: talib.MA(x, timeperiod=20))
                    prices.dropna(inplace=True); prices['bias'] = prices['close'] > prices['ma20']
                    if 'date' in prices.index.names: prices.reset_index(level='date', drop=True, inplace=True)
                    industries = audit_db.get_stock_industry_sw(prices.index.to_list(), str(ts.date()))
                    prices['industry'] = industries['industry_name']
                    prices = prices[prices['industry'] != '']
                    breadth = [{'industry': name_to_code.get(n,n), 'above': int(g['bias'].sum()), 'total': len(g),
                                'ratio': float(round(g['bias'].mean()*100))} for n,g in prices.groupby('industry')]
                    account = broker.get_account_info()
                    audit = {'date': str(ts.date()), 'cash': account['cash'], 'equity': account['total_equity'],
                             'legacyRecordedEquity': broker.equity_history[-1]['total_equity'],
                             'targets': targets, 'breadth': breadth,
                             'holdings': [{'code':c,'quantity':q} for c,q in sorted(broker.positions.items())],
                             'orders': [{'code':o.symbol,'side':o.type,'quantity':o.filled_quantity,
                                         'requested':o.quantity,'price':o.avg_fill_price,'status':o.status.lower()} for o in broker.history[start:]]}
                    trace.write(json.dumps(audit, allow_nan=False) + '\n')
    hashes = {str(p.relative_to(args.manifest.parent)): digest(p) for p in [args.manifest, *[args.manifest.parent/p['file'] for p in manifest['partitions']]]}
    hashes.update({str(p.relative_to(args.output)):digest(p) for p in (args.output/'queries').glob('*.arrow')})
    (args.output / 'snapshot-sha256.json').write_text(json.dumps(hashes, indent=2) + '\n')
    if args.rust_trace:
        compare(args.output/'python-trace.jsonl', args.rust_trace, args.output/'differences.json')


def compare(python_path, rust_path, output):
    py = {d['date']:d for d in map(json.loads, python_path.read_text().splitlines())}
    rs = {d['date']:d for d in map(json.loads, rust_path.read_text().splitlines())}
    if py.keys() != rs.keys(): raise RuntimeError('trace calendars differ')
    report = {'days':len(py), 'differences':{}, 'examples':{}}
    for date,p in py.items():
        r=rs[date]
        values = {
            'breadth': ({b['industry']:(b['above'],b['total'],b['ratio']) for b in p['breadth']}, {b['industry']:(b['above'],b['total'],b['ratio']) for b in r['breadth']}),
            'targets': (p['targets'],r['targets']),
            'holdings': ({h['code']:h['quantity'] for h in p['holdings']},{h['code']:h['quantity'] for h in r['holdings']}),
            'orders': ([(o['code'],o['side'],o['quantity']) for o in p['orders']],[(o['code'],o['side'],o['quantity']) for o in r['orders']]),
            'cash': (p['cash'],r['cash']), 'equity':(p['equity'],r['equity']),
        }
        for field,(left,right) in values.items():
            same = abs(left-right) <= 1e-7*max(1,abs(left),abs(right)) if isinstance(left,(int,float)) else left == right
            if not same:
                report['differences'][field] = report['differences'].get(field,0)+1
                examples = report['examples'].setdefault(field,[])
                if len(examples)<3: examples.append({'date':date,'python':left,'rust':right})
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k!='examples'}))


if __name__ == '__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--quent',type=Path,required=True); p.add_argument('--manifest',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True); p.add_argument('--config',type=Path)
    p.add_argument('--capture',action='store_true'); p.add_argument('--rust-trace',type=Path)
    run(p.parse_args())
