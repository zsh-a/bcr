#!/usr/bin/env python3
"""Reproducible native benchmarks including snapshot verification; POSIX per-child peak RSS."""
import argparse
import json
import os
import statistics
import time
from pathlib import Path

def measure(binary,args,output):
    fd=os.open(output,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
    start=time.perf_counter()
    pid=os.posix_spawn(str(binary),[str(binary),*map(str,args)],os.environ,file_actions=[(os.POSIX_SPAWN_DUP2,fd,1),(os.POSIX_SPAWN_CLOSE,fd)])
    os.close(fd)
    _,status,usage=os.wait4(pid,0)
    if os.waitstatus_to_exitcode(status)!=0:raise RuntimeError('native benchmark failed')
    return {'wallMs':(time.perf_counter()-start)*1000,'peakRssMiB':usage.ru_maxrss/1024,'cpuMs':(usage.ru_utime+usage.ru_stime)*1000}

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('manifest',type=Path);p.add_argument('--binary',type=Path,required=True);p.add_argument('--configs',type=Path);p.add_argument('--output',type=Path,required=True);p.add_argument('--repeat',type=int,default=3)
    a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
    manifest=json.loads(a.manifest.read_text());report={'rows':sum(p['rows'] for p in manifest['partitions']),'bytes':sum(p['bytes'] for p in manifest['partitions']),'note':'OS page cache not cleared; includes SHA-256 verification and JSONL serialization','measurements':{}}
    jobs={'single':[a.manifest,'--jsonl']}
    if a.configs:jobs.update({'grid-1':[ 'grid',a.manifest,a.configs,'--threads','1'],'grid-8':['grid',a.manifest,a.configs,'--threads','8']})
    for name,args in jobs.items():
        points=[measure(a.binary.resolve(),args,a.output/(name+'.jsonl')) for _ in range(a.repeat)]
        report['measurements'][name]={'runs':points,'medianMs':statistics.median(r['wallMs'] for r in points)}
    (a.output/'statistics.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
