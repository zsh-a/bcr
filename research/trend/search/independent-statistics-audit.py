"""One-off read-only check, independent direct-index bootstrap; no price execution."""
import hashlib,json,math,random,statistics,sys
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path.cwd()/'scripts/trend'))
from artifacts import load_evidence,audit_window,sha
P=Path('research/trend/search-plan.json'); M=Path('tmp/trend-search-v8/manifest.json'); D=Path('tmp/trend-search-v8'); E=Path('research/trend/search/search-evaluation.json')
plan=json.loads(P.read_text()); result=json.loads(E.read_text()); selection=json.loads((D/'selection.json').read_text())
evidence=load_evidence(P,M,D); ids=[c['id'] for c in plan['candidates']]; keys=[(name,cost) for name in ids for cost in ('base','stress')]
settings=plan['searchEvaluation']; initial=plan['initialCapital']; sampled=[]; summaries={}; provenance=[]; batch_count=row_count=shard_count=trade_count=0; raw_hashes=[]; selected_accounts={}; dev_candidates=[]; max_dev_sharpe_error=0
for window in plan['windows']:
 batches,_=audit_window(evidence,window)
 for batch in batches:
  path=D/window['id']/(batch['symbol']+'.json'); receipt=json.loads(path.with_suffix('.receipt.json').read_text()); raw_hashes.append((str(path),sha(path)))
  batch_count+=1; row_count+=len(batch['results']); shard_count+=len(receipt['shards']); trade_count+=sum(len(row['trades']) for row in batch['results'])
  assert all(len(json.loads((path.parent/s['configsPath']).read_text()))<=16 for s in receipt['shards'])
 indexed=[{r['id']:r for r in b['results']} for b in batches]
 if window['id']=='development':
  stored={r['id']:r for r in json.loads((D/'development-summary.json').read_text())}
  for name in ids:
   rows=[i[name] for i in indexed]; equities=[sum(r['daily'][d]['equity'] for r in rows) for d in range(len(rows[0]['daily']))]
   returns=[value/previous-1 for previous,value in zip([initial]+equities[:-1],equities)]
   sharp=statistics.mean(returns)/statistics.stdev(returns)*math.sqrt(365) if statistics.stdev(returns)>0 else None
   if sharp is not None:
    max_dev_sharpe_error=max(max_dev_sharpe_error,abs(sharp-stored[name]['dailySharpe']))
   if sharp is not None and all(len(r['trades'])>=plan['selectionMinTrades'] for r in rows):
    dev_candidates.append((name,sharp))
  chosen=max(dev_candidates,key=lambda x:x[1]); assert chosen[0]==selection['id']
  row=stored[chosen[0]]; qualified=row['profitableSymbols']>=plan['selectionMinProfitableSymbols'] and row['medianSymbolMeanR']>0
  assert qualified==selection['developmentQualified']; continue
 if window['id'] not in settings['windows']: continue
 columns=[]; selected_accounts[window['id']]={}
 for name,cost in keys:
  request=name+('-stress' if cost=='stress' else ''); rows=[i[request] for i in indexed]
  n=len(rows[0]['daily']); equities=[sum(r['daily'][d]['equity'] for r in rows) for d in range(n)]
  returns=[value/previous-1 for previous,value in zip([initial]+equities[:-1],equities)]
  assert len(returns)==n and all(math.isfinite(r) for r in returns)
  columns.append(returns)
  if name==selection['id']:
   peak=initial; dd=0
   for value in equities: peak=max(peak,value); dd=min(dd,value/peak-1)
   selected_accounts[window['id']][cost]={'return':equities[-1]/initial-1,'dailyMaxDrawdown':dd,'counts':{b['symbol']:len(r['trades']) for b,r in zip(batches,rows)}}
 sampled.append(np.array(columns,dtype=float))
 print('audited',window['id'],n,flush=True)
assert batch_count==36 and row_count==2112 and shard_count==132
N=sum(v.shape[1] for v in sampled); assert N==973
means=np.array([math.fsum(v for w in sampled for v in w[j])/N for j in range(64)])
base_index={cost:keys.index((plan['baseline'],cost)) for cost in ('base','stress')}; increment=[j for j,(name,cost) in enumerate(keys) if name!=plan['baseline']]
max_error=0; p_mismatches=[]; output=[]
def family(mu,draws):
 observed=np.sqrt(N)*np.maximum(0,mu); null=np.maximum(0,np.max(np.sqrt(N)*(draws-mu[:,None]),axis=0))
 def probability(t):
  return (1+sum(v>=t or math.isclose(v,t,rel_tol=1e-12,abs_tol=1e-14) for v in null))/(len(null)+1)
 return observed,np.array([probability(x) for x in observed]),probability(float(max(observed)))
for block in settings['blockDays']:
 rng=random.Random(settings['seed']); estimates=np.zeros((64,settings['samples']))
 for b in range(settings['samples']):
  sums=np.zeros(64)
  for w in sampled:
   n=w.shape[1]; indexes=[]
   while len(indexes)<n:
    start=rng.randrange(n); indexes.extend((start+i)%n for i in range(min(block,n-len(indexes))))
   # Directly index each daily observation: no production prefix sums or sampler.
   sums+=w[:,indexes].sum(axis=1)
  estimates[:,b]=sums/N
 observed,pvalues,globalp=family(means,estimates)
 im=np.array([means[j]-means[base_index[keys[j][1]]] for j in increment]); ie=np.array([estimates[j]-estimates[base_index[keys[j][1]]] for j in increment]); io,ip,ig=family(im,ie)
 record=next(v for v in result['bootstrap'] if v['blockDays']==block)
 assert record['families']['cash']['seriesCount']==64 and record['families']['baselineIncremental']['seriesCount']==62
 assert record['families']['cash']['globalPValue']==globalp and record['families']['baselineIncremental']['globalPValue']==ig
 for j,(name,cost) in enumerate(keys):
  row=record['candidates'][name][cost]['absolute']; ci=np.sort(estimates[j])[[int(settings['samples']*.025),int(settings['samples']*.975)]]
  max_error=max(max_error,abs(row['meanDailyReturn']-means[j]),max(abs(ci-np.array(row['meanDailyReturn95CI']))))
  if pvalues[j]!=row['adjustedPValue']: p_mismatches.append((block,name,cost,'absolute'))
 for k,j in enumerate(increment):
  name,cost=keys[j]; row=record['candidates'][name][cost]['relativeToBaseline']; ci=np.sort(ie[k])[[int(settings['samples']*.025),int(settings['samples']*.975)]]
  max_error=max(max_error,abs(row['meanDailyReturn']-im[k]),max(abs(ci-np.array(row['meanDailyReturn95CI']))))
  if ip[k]!=row['adjustedPValue']: p_mismatches.append((block,name,cost,'relative'))
 output.append({'blockDays':block,'cashGlobalP':globalp,'incrementGlobalP':ig,'selected':record['candidates'][selection['id']]})
assert not p_mismatches and max_error<1e-12
# Independently rebuild every selected acceptance condition.
checks={}; checks['development-qualified']=qualified; checks['minimum-validation-days']=N>=settings['minimumDays']
for cost in ('base','stress'):
 counts={s:sum(a[cost]['counts'][s] for a in selected_accounts.values()) for s in plan['symbols']}
 checks[f'{cost}:minimum-trades']=sum(counts.values())>=settings['minimumTrades']
 for symbol,count in counts.items(): checks[f'{cost}:minimum-trades:{symbol}']=count>=settings['minimumTradesPerSymbol']
 for name,a in selected_accounts.items():
  checks[f'{cost}:{name}:positive-return']=a[cost]['return']>0
  checks[f'{cost}:{name}:daily-drawdown']=a[cost]['dailyMaxDrawdown']>=-settings['maxDailyDrawdown']
 for v in result['bootstrap']:
  row=v['candidates'][selection['id']][cost]['absolute']; block=v['blockDays']
  checks[f'{cost}:block{block}:absolute-lower-bound']=row['meanDailyReturn95CI'][0]>0
  checks[f'{cost}:block{block}:selected-cash-adjusted-p']=row['adjustedPValue']<=settings['alpha']
assert checks=={r['criterion']:r['passed'] for r in result['acceptance']['checks']}
assert ('not-established' if not all(checks.values()) else 'historical-criteria-passed')==result['status']
record={'scope':'Daily ledger/selection/receipt/stratified max-test audit, no price-source or minute execution audit','inputs':{'plan':sha(P),'manifest':sha(M),'selection':sha(D/'selection.json'),'developmentSummary':sha(D/'development-summary.json'),'searchEvaluation':sha(E),'rawResults':raw_hashes,'script':sha(__file__)},'counts':{'batches':batch_count,'rows':row_count,'shards':shard_count,'trades':trade_count,'validationDays':N,'eligibles':len(dev_candidates),'acceptanceChecks':len(checks)},'selected':selection['id'],'developmentSharpe':chosen[1],'maxDevelopmentSharpeError':max_dev_sharpe_error,'maxMeanOrCIError':float(max_error),'pValueMismatches':p_mismatches,'checks':checks,'status':result['status'],'bootstrap':output}
Path('/tmp/search-independent-review.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps({k:v for k,v in record.items() if k not in ('inputs','checks','bootstrap')},indent=2))
print('failed:',[k for k,v in checks.items() if not v])
