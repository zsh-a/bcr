import concurrent.futures,csv,datetime as dt,hashlib,json,math,sys,urllib.request
from collections import Counter
from pathlib import Path
ROOT=Path('/home/zs/workspace/bcr');sys.path.insert(0,str(ROOT/'scripts/trend'))
from artifacts import atomic_bytes,read,sha,write_once
from details_audit import Sources,check,equal
from protocol import timestamp
PLAN=ROOT/'research/trend/robustness-plan.json'; MANIFEST=ROOT/'tmp/trend-robustness-v8/manifest.json';OUT=ROOT/'research/trend/robustness'; MINUTE=60000
expected_plan='fddd5800b6d38e9f5a6ba09441be3b245a4ff82a3fde56944b0969e21459d78d'
check(sha(PLAN)==expected_plan,'frozen plan identity')
plan,manifest=read(PLAN),read(MANIFEST);manifest_hash=sha(MANIFEST)
check(manifest['planSha256']==expected_plan,'manifest plan identity')
check(set(manifest['symbols'])==set(plan['symbols']),'manifest symbol universe')
check(sha(ROOT/plan['availability']['path'])==plan['availability']['sha256'],'frozen availability identity')
sources=Sources(manifest)
raw=[r for r in sources.records.values() if 'url' in r]
def official(record):
 url=record['url']+'.CHECKSUM'
 check(url.startswith('https://data.binance.vision/'),'nonofficial archive URL')
 for attempt in range(2):
  try:
   with urllib.request.urlopen(url,timeout=30) as response:
    token=response.read(4096).decode().split()[0].lower()
    check(token==record['zipSha256'],'official archive checksum changed: '+record['path'])
    return {'url':url,'status':response.status,'zipSha256':token,'csvPath':record['path']}
  except Exception:
   if attempt:raise

def rows_by_time(path):
 rows={}
 with Path(path).open() as stream:
  for line in stream:
   if line.startswith('open_time'):continue
   t=int(line.split(',',1)[0]);check(t not in rows,'duplicate derived-source timestamp')
   rows[t]=line.rstrip('\r\n')
 return rows

def check_repair(record):
 parents=record['sources']; days=record['replacedDays']
 check(len(parents)==len(days)+1,'daily replacement lineage count')
 original=rows_by_time(parents[0]['path'])
 for day,parent in zip(days,parents[1:]):
  start=timestamp(day);daily=rows_by_time(parent['path'])
  check(set(daily)==set(range(start,start+86400000,MINUTE)),'daily repair calendar')
  original.update(daily)
 h=hashlib.sha256()
 for t in sorted(original):h.update((original[t]+'\n').encode())
 check(h.hexdigest()==record['csvSha256'],'repaired CSV differs from declared monthly plus daily replacements')
 return {'path':record['path'],'csvSha256':record['csvSha256'],'days':days,'sources':[{'path':r['path'],'csvSha256':r['csvSha256']} for r in parents]}

with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
 futures=[pool.submit(official,r) for r in raw]
 repairs=[]
 for record in sources.records.values():
  sources.verify(record['path'],record['csvSha256'])
  if 'replacedDays' in record:repairs.append(check_repair(record))
 print('source CSV hashes/lineage',len(sources.verified),'daily repairs',len(repairs),flush=True)
 coverage=[];symbol_summary={};warmups=[]
 for candidate in plan['candidates']:
  check(candidate['entry']=='breakout' and candidate['management']=='channel' and candidate['filter']=='none','unexpected warmup mechanism')
  warmups.append({'candidate':candidate['id'],'days':max(1,math.ceil(max(14,candidate['breakoutBars'],candidate['channelExitBars'])*candidate['tradeMinutes']/1440))})
 max_warmup=max(r['days'] for r in warmups)
 check(max_warmup==14,'declared maximum warmup')
 windows={w['id']:w for w in manifest['warmupWindows']}
 check(set(windows)=={w['id'] for w in plan['windows']},'manifest windows')
 for symbol,source in manifest['symbols'].items():
  funding=[];funding_archives=[]
  for record in source['archives']:
   if '/fundingRate/' not in record.get('url',''):continue
   funding_archives.append(record['path'])
   with Path(record['path']).open() as stream:
    for row in csv.DictReader(stream):
     funding.append({'time':int(row['calc_time']),'rate':float(row['last_funding_rate']),'intervalHours':float(row['funding_interval_hours'])})
  sources.verify(source['funding'],source['fundingSha256'])
  check(funding==read(source['funding']),'funding aggregate differs from official monthly CSVs')
  symbol_summary[symbol]={'archives':len(source['archives']),'partitions':len(source['partitions']),
                          'fundingArchives':len(funding_archives),'fundingEvents':len(funding),
                          'fundingSha256':source['fundingSha256'],
                          'scopedPartitions':[p for p in source['partitions'] if 'from' in p]}
  for window in plan['windows']:
   m=windows[window['id']];start,end=timestamp(window['start']),timestamp(window['end']);warmup=start-max_warmup*86400000
   check(m['warmupDays']==max_warmup and timestamp(m['warmupStart'])==warmup,'manifest warmup coverage')
   check(all(m[k]==window[k] for k in window),'manifest window identity')
   minutes,marks,events=sources.load(symbol,warmup,start,end)
   coverage.append({'window':window['id'],'symbol':symbol,'warmupStart':warmup,'startTime':start,'endTime':end,
                    'priceRowsPerSource':len(minutes),'expectedRowsPerSource':(end-warmup)//MINUTE,
                    'firstMinute':int(minutes[0,0]),'lastMinute':int(minutes[-1,0]),'fundingEventsInActiveWindow':len(events),
                    'fundingFirst':events[0]['time'],'fundingLast':events[-1]['time'],'status':'passed'})
   print('calendar',symbol,window['id'],len(minutes),len(events),flush=True)
 official_checks=[f.result() for f in futures]
check(sha(PLAN)==expected_plan and sha(MANIFEST)==manifest_hash,'identity changed during validation')
result={'version':'trend-robustness-data-quality-1','status':'passed','planSha256':expected_plan,'manifestSha256':manifest_hash,
        'generatorSha256':manifest['generatorSha256'],'validatorScriptSha256':sha(__file__),'createdAt':dt.datetime.now(dt.timezone.utc).isoformat(),
        'warmupPolicy':manifest['warmupPolicy'],'candidateWarmupDays':warmups,'priceValidation':manifest['priceValidation'],'warmupWindows':manifest['warmupWindows'],
        'symbols':symbol_summary,'coverage':coverage,'counts':{'windows':len(plan['windows']),'symbols':len(plan['symbols']),
        'windowSymbolChecks':len(coverage),'priceRowsPerSourceAcrossWindowChecks':sum(r['priceRowsPerSource'] for r in coverage),
        'sourceFilesRehashed':len(sources.verified),'officialArchiveChecksumsRefetched':len(official_checks),'repairedPartitionsVerified':len(repairs),
        'continuousReplaySlicesVerified':sum(r.get('validation',{}).get('policy')=='continuous-replay-interval-v1' for r in sources.records.values())},
        'repairs':repairs,'officialChecksumChecks':official_checks,
        'sourceHashes':[{'path':path,'sha256':value} for path,value in sorted(sources.verified.items())],
        'scope':'All11 declared windows and all6 fixed symbols. Rehash all raw/derived CSV parents and funding JSON; independently reconstruct each monthly+official-day replacement and each scoped replay slice. Re-fetch every official ZIP CHECKSUM and require exact receipt match. Validate each actual14day-warmup..end complete, chronological, aligned traded/mark minute sequence including OHLC constraints. Rebuild funding JSON from official monthly CSV fields and validate active-window funding boundaries/gaps. No strategy replay or returns read.',
        'limits':['Window checks include overlapping warmups and are not unique market-minute counts.','Official ZIP checksum text is re-fetched; ZIP bytes are not redownloaded for cached archives. Original extraction provenance relies on immutable archive receipts and downloader verification; all referenced CSV bytes are independently rehashed.','This validates only the declared ranges. Required-range source files may retain gaps outside those ranges. July2022 and August2024 remain incomplete for full-month research; no interpolation or substitution occurred.','Funding completeness uses recorded historical intervalHours and existing validation policy; no fixed8hour or zero-funding substitution.']}
write_once(OUT/'data-quality.json',result)
atomic_bytes(OUT/'availability.json',(ROOT/plan['availability']['path']).read_bytes(),replace=False)
print('PASSED',json.dumps(result['counts']),'MANIFEST_SHA',manifest_hash,'QUALITY_SHA',sha(OUT/'data-quality.json'),'AVAILABILITY_SHA',sha(OUT/'availability.json'),flush=True)
