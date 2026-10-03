import concurrent.futures, datetime as dt, hashlib, json, subprocess, sys
from pathlib import Path
ROOT=Path('/home/zs/workspace/bcr')
INPUT=ROOT/'tmp/trend-robustness-v8'
OUTPUT=ROOT/'tmp/trend-engine14-expansion-parity'
WINDOW='known-2025'
MANIFEST=INPUT/'manifest.json'
BINARY={'old':ROOT/'tmp/trend-engine14-before-expansion','new':ROOT/'crates/quant/target/release/trend'}
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def timestamp(date): return str(int(dt.datetime.fromisoformat(date).replace(tzinfo=dt.timezone.utc).timestamp()*1000))
def invoke(job):
    version,symbol=job
    directory=OUTPUT/version
    directory.mkdir(parents=True,exist_ok=True)
    out=directory/(symbol+'.json')
    assert not out.exists(),str(out)
    configs=INPUT/WINDOW/(symbol+'-configs.json')
    command=[str(BINARY[version]),str(MANIFEST),symbol,str(configs),timestamp('2025-01-01'),timestamp('2026-01-01'),str(out),WINDOW]
    subprocess.run(command,check=True,capture_output=True,text=True)
    print(version,symbol,sha(out),flush=True)
    return out
symbols=list(json.loads(MANIFEST.read_text())['symbols'])
mode=sys.argv[1]
if mode in ('old','new'):
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:list(pool.map(invoke,[(mode,s) for s in symbols]))
else:
    records=[]
    for symbol in symbols:
        old,new,recorded=OUTPUT/'old'/(symbol+'.json'),OUTPUT/'new'/(symbol+'.json'),INPUT/WINDOW/(symbol+'.json')
        assert old.read_bytes()==new.read_bytes(),symbol+' old/new byte mismatch'
        assert old.read_bytes()==recorded.read_bytes(),symbol+' frozen/old byte mismatch'
        rows=json.loads(old.read_text())['results']
        records.append({'symbol':symbol,'bytes':old.stat().st_size,'sha256':sha(old),'candidateCostRows':len(rows),'trades':sum(len(r['trades']) for r in rows),'configsSha256':sha(INPUT/WINDOW/(symbol+'-configs.json'))})
    result={'status':'passed','comparison':'exact-byte-equality-old-new-and-frozen-results','window':WINDOW,'start':'2025-01-01','endExclusive':'2026-01-01','planSha256':json.loads(MANIFEST.read_text())['planSha256'],'manifestSha256':sha(MANIFEST),'binaries':{k:{'path':str(v.relative_to(ROOT)),'sha256':sha(v)} for k,v in BINARY.items()},'scriptSha256':sha(Path(__file__)),'records':records}
    with (OUTPUT/'comparison.json').open('x') as f:json.dump(result,f,indent=2);f.write('\n')
    print(json.dumps(result),flush=True)
