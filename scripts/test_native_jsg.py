"""Native CLI / real SQL integration using an isolated embedded ClickHouse fixture.
Requires chdb and an already built native CLI. Never writes to the user's server.
"""
import datetime as dt
import http.server
import json
import os
import re
import subprocess
import tempfile
import threading
import unittest
import urllib.parse
from pathlib import Path
import chdb.session

ROOT=Path(__file__).resolve().parents[1]
BINARY=Path(os.environ.get('JSG_BINARY',ROOT/'crates/quant/target/release/jsg'))

class NativeIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory();cls.root=Path(cls.tmp.name)
        cls.db=chdb.session.Session(str(cls.root/'ch'))
        def query(sql,fmt='CSV'):return cls.db.query(sql,fmt)
        cls.query=query
        query('CREATE DATABASE stock_data')
        for statement in re.sub(r'--[^\n]*','',(ROOT/'crates/quant/sql/history-schema.sql').read_text()).split(';'):
            if 'CREATE TABLE' in statement:query(statement.replace('CREATE TABLE ','CREATE TABLE stock_data.'))
        definitions={
            'stock_daily':'date Date,code String,open Float64,high Float64,low Float64,close Float64,preclose Float64,adjfactor Float64,volume UInt64,isST Int16,tradestatus Int16',
            'trade_dates':'calendar_date Date,is_trading_day UInt8',
            'index_stocks':'`index` String,code String,enter_date Date',
            'industry_info':'code String,enter_date Date,industry_code String,industry_name String',
            'shares_info':'code String,change_date Date,publish_date Date,total_shares Float64',
            'finicial_report':'code String,publish_date Date,report_date Date,adjusted_profit_diff Float64,circulating_a Float64',
        }
        keys={'stock_daily':'code,date','trade_dates':'calendar_date','index_stocks':'`index`,code','industry_info':'code,enter_date','shares_info':'code,change_date,publish_date','finicial_report':'code,report_date'}
        for table,cols in definitions.items():query(f'CREATE TABLE stock_data.{table} ({cols}) ENGINE=ReplacingMergeTree ORDER BY ({keys[table]})')
        dates=[dt.date(2023,11,1)+dt.timedelta(days=i) for i in range(160)]
        dates=[d for d in dates if d.weekday()<5]
        query('INSERT INTO stock_data.trade_dates VALUES '+','.join(f"('{d}',1)" for d in dates))
        prices=[];limits=[]
        for d in dates:
            for code in ['sz.001001','sz.001002']:
                price=10+(d-dates[0]).days*0.01
                prices.append(f"('{d}','{code}',{price},{price},{price},{price},{price},1,1000000,0,1)")
                limits.append(f"('{d}','{code}',100,1,1)")
        query('INSERT INTO stock_data.stock_daily VALUES '+','.join(prices))
        query('INSERT INTO stock_data.stock_daily_execution VALUES '+','.join(limits))
        for code in ['sz.001001','sz.001002']:
            query(f"INSERT INTO stock_data.index_stocks VALUES ('000985','{code}','2023-01-01'),('399101','{code}','2023-01-01')")
            query(f"INSERT INTO stock_data.index_membership_history VALUES ('000985','{code}','2023-01-01','2022-12-31',1,1),('399101','{code}','2023-01-01','2022-12-31',1,1)")
            query(f"INSERT INTO stock_data.financial_revisions VALUES ('{code}','2023-09-30','2023-10-31',1,100000000,100000000,1)")
            query(f"INSERT INTO stock_data.finicial_report VALUES ('{code}','2023-10-31','2023-09-30',1,100000000)")
            query(f"INSERT INTO stock_data.industry_info VALUES ('{code}','2023-01-01','tech','Tech')")
            query(f"INSERT INTO stock_data.shares_info VALUES ('{code}','2023-01-01','2023-01-01',100000000)")
        for name in ['membership','financials','corporateActions','priceLimits']:
            query(f"INSERT INTO stock_data.research_coverage VALUES ('{name}','2023-01-01','2025-01-01',1,'fixture',now())")
        # Exit is effective Jan 25 but published Jan 26; not visible until Jan 27.
        query("INSERT INTO stock_data.index_membership_history VALUES ('399101','sz.001001','2024-01-25','2024-01-26',0,2)")
        # The revision must not rewrite pre-publication financial features.
        query("INSERT INTO stock_data.financial_revisions VALUES ('sz.001002','2023-09-30','2024-01-29',-1,100000000,100000000,2)")
        cls.request_errors=[]
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                options=urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
                if options.get('readonly')!=['1']:self.send_error(400);return
                sql=self.rfile.read(int(self.headers['Content-Length'])).decode()
                if not re.match(r'\s*(SELECT|WITH)\b',sql):self.send_error(400);return
                sql=re.sub(r'\{(\w+):[^}]+\}',lambda m:"'"+options['param_'+m[1]][0].replace("'","''")+"'",sql)
                sql=re.sub(r'\bFROM (stock_daily|trade_dates|index_stocks|industry_info|shares_info|finicial_report|index_membership_history|financial_revisions|stock_daily_execution|corporate_actions|research_coverage)\b',r'FROM stock_data.\1',sql)
                sql=re.sub(r'\bJOIN (stock_daily_execution)\b',r'JOIN stock_data.\1',sql)
                fmt='ArrowStream' if sql.rstrip().endswith('FORMAT ArrowStream') else 'JSONEachRow'
                sql=re.sub(r'\s+FORMAT \w+\s*$','',sql)
                try:payload=query(sql,fmt).bytes()
                except Exception as e:cls.request_errors.append(str(e));self.send_error(500,str(e));return
                self.send_response(200);self.end_headers();self.wfile.write(payload)
            def log_message(self,*args):pass
        cls.server=http.server.HTTPServer(('127.0.0.1',0),Handler)
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start()
        cls.env={**os.environ,'CLICKHOUSE_URL':f'http://127.0.0.1:{cls.server.server_port}/','CLICKHOUSE_DATABASE':'stock_data'}

    @classmethod
    def tearDownClass(cls):cls.server.shutdown();cls.server.server_close();cls.db.close();cls.tmp.cleanup()

    def cli(self,*args,success=True):
        p=subprocess.run([str(BINARY),*map(str,args)],env=self.env,capture_output=True,text=True)
        if success:self.assertEqual(p.returncode,0,p.stderr+"\n"+"\n".join(self.request_errors))
        return p

    def test_snapshot_raw_history_and_tamper_detection(self):
        output=self.root/'historical';self.cli('export','2024-01-24','2024-01-31',output,'--strict-pit')
        manifest=json.loads((output/'manifest.json').read_text());self.assertEqual(manifest['version'],2)
        config={'initialCapital':100000,'poolSize':2,'stockCount':1,'commissionBps':0,'slippageBps':0,'stopLoss':0,'trailingStop':0,'maxDrawdown':0,'tPlusOne':False,'industryBlacklist':[], 'executionModel':'jsg-raw-v2','fees':[{'from':20200101,'minimumCommission':0,'transferBps':0,'sellTaxBps':0}]}
        path=self.root/'config.json';path.write_text(json.dumps(config))
        result=json.loads(self.cli(output/'manifest.json',path).stdout)
        self.assertEqual(result['metrics']['model'],'jsg-raw-v2')
        import pyarrow as pa
        rows=[]
        for partition in manifest['partitions']:
            with pa.ipc.open_stream(output/partition['file']) as r:rows+=r.read_all().to_pylist()
        first=[r for r in rows if r['id']==0]
        self.assertEqual(next(r for r in first if r['date']==20240126)['selection_member'],1)
        self.assertEqual(next(r for r in first if r['date']==20240129)['selection_member'],0)
        second=[r for r in rows if r['id']==1]
        self.assertGreater(next(r for r in second if r['date']==20240129)['profit'],0)
        self.assertLess(next(r for r in second if r['date']==20240130)['profit'],0)
        partition=output/manifest['partitions'][0]['file'];data=bytearray(partition.read_bytes());data[-1]^=1;partition.write_bytes(data)
        rejected=self.cli(output/'manifest.json',path,success=False)
        self.assertNotEqual(rejected.returncode,0);self.assertIn('integrity mismatch',rejected.stderr)

    def test_existing_output_is_preserved(self):
        dest=self.root/'existing';dest.mkdir();(dest/'sentinel').write_text('keep')
        self.assertNotEqual(self.cli('export','2024-01-24','2024-01-31',dest,success=False).returncode,0)
        self.assertEqual((dest/'sentinel').read_text(),'keep')
        relative=subprocess.run([str(BINARY),'export','2024-01-24','2024-01-31','relative-snapshot'],env=self.env,cwd=self.root,capture_output=True,text=True)
        self.assertEqual(relative.returncode,0,relative.stderr)
        self.assertTrue((self.root/'relative-snapshot'/'manifest.json').is_file())

if __name__=='__main__':unittest.main()
