WITH
  breadth AS (SELECT code FROM index_stocks FINAL WHERE index = {breadth:String}),
  selection AS (SELECT code FROM index_stocks FINAL WHERE index = {selection:String})
SELECT toUInt32(formatDateTime(p.date, '%Y%m%d')) AS date, p.code AS code,
       coalesce(nullIf(i.industry_code, ''), 'unknown') AS industry_code,
       toFloat64(p.open) AS open, toFloat64(p.high) AS high, toFloat64(p.low) AS low,
       toFloat64(p.close) AS close, toFloat64(p.preclose) AS preclose, toFloat64(p.adjfactor) AS adjfactor,
       toFloat64(ifNull(f.profit, 0)) AS profit, toFloat64(ifNull(s.shares, 0)) AS shares,
       toUInt8(p.isST != 0) AS is_st, toUInt8(p.tradestatus = 1) AS tradable,
       toUInt8(p.code IN breadth) AS breadth_member, toUInt8(p.code IN selection) AS selection_member
FROM (SELECT * FROM stock_daily FINAL
      WHERE date BETWEEN {start:Date} AND {end:Date}
        AND (code IN breadth OR code IN selection)
        AND open > 0 AND high > 0 AND low > 0 AND close > 0 AND preclose > 0 AND adjfactor > 0) AS p
ASOF LEFT JOIN
  (SELECT code, publish_date, argMax(adjusted_profit_diff, report_date) AS profit
   FROM finicial_report FINAL WHERE publish_date < {end:Date}
     AND (code IN breadth OR code IN selection)
   GROUP BY code, publish_date ORDER BY code, publish_date) AS f
ON p.code = f.code AND p.date > f.publish_date
ASOF LEFT JOIN
  (SELECT code, greatest(change_date, publish_date) AS available_date,
          argMax(total_shares, tuple(change_date, publish_date)) AS shares
   FROM shares_info FINAL WHERE greatest(change_date, publish_date) < {end:Date}
     AND (code IN breadth OR code IN selection)
   GROUP BY code, available_date ORDER BY code, available_date) AS s
ON p.code = s.code AND p.date > s.available_date
ASOF LEFT JOIN
  (SELECT code, enter_date, industry_code FROM industry_info FINAL
   WHERE enter_date <= {end:Date} AND (code IN breadth OR code IN selection)
   ORDER BY code, enter_date) AS i
ON p.code = i.code AND p.date >= i.enter_date
ORDER BY date, code
FORMAT ArrowStream
