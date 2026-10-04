/** Prices are illustrative assumptions in yuan. Cash costs exclude travel and time. */
export function costs({ annualPrice, visitPrice, visits }) {
  const payPerVisitTotal = visitPrice * visits;
  return {
    annualTotal: annualPrice,
    payPerVisitTotal,
    comparison:
      annualPrice === payPerVisitTotal
        ? "equal"
        : annualPrice < payPerVisitTotal
          ? "annual-cheaper"
          : "per-visit-cheaper",
    average: annualPrice / visits,
    breakEven: annualPrice / visitPrice,
    firstCheaperVisit: Math.floor(annualPrice / visitPrice) + 1,
  };
}
