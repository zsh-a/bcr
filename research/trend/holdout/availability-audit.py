import concurrent.futures,datetime as dt,hashlib,json,time,urllib.error,urllib.request
from collections import Counter
from pathlib import Path
SYMBOLS=['ADAUSDT','BCHUSDT','ETCUSDT','LINKUSDT','LTCUSDT','TRXUSDT']
BASE='https://data.binance.vision/data/futures/um/monthly'
def months(start,end):
 y,m=map(int,start.split('-')); result=[]
 while f'{y:04}-{m:02}'<end:
  result.append(f'{y:04}-{m:02}');y,m=(y+1,1) if m==12 else (y,m+1)
 return result
def probe(job):
 symbol,kind,month=job;interval='' if kind=='fundingRate' else '1m/'
 stem=f'{symbol}-{kind if kind=="fundingRate" else "1m"}-{month}'
 url=f'{BASE}/{kind}/{symbol}/{interval}{stem}.zip.CHECKSUM'
 value={'symbol':symbol,'kind':kind,'month':month,'url':url}
 for attempt in range(2):
  try:
   with urllib.request.urlopen(url,timeout=20) as response:
    text=response.read(4096).decode();token=text.split()[0].lower()
    assert len(token)==64 and all(c in '0123456789abcdef' for c in token)
    value.update(status=response.status,zipSha256=token)
   return value
  except urllib.error.HTTPError as e:
   value.update(status=e.code,error=str(e));return value
  except Exception as e:
   if attempt:value.update(status='request-error',error=str(e));return value
jobs=[(s,k,m) for s in SYMBOLS for k in ['klines','markPriceKlines','fundingRate'] for m in months('2024-09' if k=='fundingRate' else '2024-08','2026-10')]
with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
 results=list(pool.map(probe,jobs))
summary={s:{k:dict(Counter(str(r['status']) for r in results if r['symbol']==s and r['kind']==k)) for k in ['klines','markPriceKlines','fundingRate']} for s in SYMBOLS}
result={'createdAt':dt.datetime.now(dt.timezone.utc).isoformat(),'scope':'CHECKSUM metadata only; no ZIP or price/return data read. Existence does not prove minute completeness.','candidateUniverse':SYMBOLS,'activeWindow':{'start':'2024-09-01','endExclusive':'2026-10-01','days':760},'priceWarmupArchiveMonth':'2024-08','frozenStrategyWarmupDays':7,'checks':results,'statusCounts':dict(Counter(str(r['status']) for r in results)),'bySymbolAndKind':summary,'scriptSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
Path('/tmp/trend-oos-availability.json').write_text(json.dumps(result,indent=2))
print(json.dumps({k:v for k,v in result.items() if k not in ['checks']},indent=2));print('not available',[r for r in results if r['status']!=200])
