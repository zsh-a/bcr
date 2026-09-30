WITH
  universe AS (SELECT DISTINCT code FROM index_membership_history FINAL WHERE index IN ({breadth:String},{selection:String}) AND publish_date < {end:Date}),
  memberships AS (
    SELECT index,code,greatest(effective_date,addDays(publish_date,1)) AS available_date,
           argMax(is_member,tuple(effective_date,publish_date,version)) AS member
    FROM index_membership_history FINAL WHERE publish_date < {end:Date} AND index IN ({breadth:String},{selection:String})
    GROUP BY index,code,available_date ORDER BY code,available_date
  )
SELECT toUInt32(formatDateTime(p.date,'%Y%m%d')) AS date,p.code AS code,
       coalesce(nullIf(i.industry_code,''),'unknown') AS industry_code,
       toFloat64(p.open) AS open,toFloat64(p.high) AS high,toFloat64(p.low) AS low,
       toFloat64(p.close) AS close,toFloat64(p.preclose) AS preclose,toFloat64(p.adjfactor) AS adjfactor,
       toFloat64(ifNull(f.profit,0)) AS profit,toFloat64(ifNull(s.shares,0)) AS shares,
       toUInt8(p.isST!=0) AS is_st,toUInt8(p.tradestatus=1) AS tradable,
       toUInt8(ifNull(b.member,0)) AS breadth_member,toUInt8(ifNull(t.member,0)) AS selection_member,
       toUInt64(p.volume) AS volume,toFloat64(e.limit_up) AS limit_up,toFloat64(e.limit_down) AS limit_down
FROM (SELECT * FROM stock_daily FINAL WHERE date BETWEEN {start:Date} AND {end:Date} AND code IN universe
      AND open>0 AND high>0 AND low>0 AND close>0 AND preclose>0 AND adjfactor>0) p
INNER JOIN (SELECT * FROM stock_daily_execution FINAL WHERE date BETWEEN {start:Date} AND {end:Date}) e ON p.code=e.code AND p.date=e.date
ASOF LEFT JOIN (SELECT * FROM memberships WHERE index={breadth:String} ORDER BY code,available_date) b ON p.code=b.code AND p.date>=b.available_date
ASOF LEFT JOIN (SELECT * FROM memberships WHERE index={selection:String} ORDER BY code,available_date) t ON p.code=t.code AND p.date>=t.available_date
ASOF LEFT JOIN (
    SELECT code,publish_date,argMax(adjusted_profit_diff,tuple(report_date,version)) AS profit
    FROM financial_revisions FINAL WHERE publish_date < {end:Date} AND circulating_a>0 AND code IN universe
    GROUP BY code,publish_date ORDER BY code,publish_date
) f ON p.code=f.code AND p.date>f.publish_date
ASOF LEFT JOIN (
    SELECT code,greatest(change_date,publish_date) AS available_date,argMax(total_shares,tuple(change_date,publish_date)) AS shares
    FROM shares_info FINAL WHERE greatest(change_date,publish_date)<{end:Date} AND code IN universe
    GROUP BY code,available_date ORDER BY code,available_date
) s ON p.code=s.code AND p.date>s.available_date
ASOF LEFT JOIN (SELECT code,enter_date,industry_code FROM industry_info FINAL WHERE enter_date<={end:Date} AND code IN universe ORDER BY code,enter_date) i
ON p.code=i.code AND p.date>=i.enter_date
ORDER BY date,code FORMAT ArrowStream
