/**
 * 월별 집계.
 *
 * 원장을 통째로 재생하지 않고 이벤트에서 바로 뽑는다. 이벤트가 수백만 건이라
 * reduce를 월 단위로 다시 돌리면 리포트 생성이 분 단위로 늘어난다.
 */
export function monthlyTotals(events) {
  const totals = {};
  for (const event of events) {
    const month = event.date.slice(0, 7);
    totals[month] ??= { inflow: 0, outflow: 0 };

    if (event.type === 'charge') {
      totals[month].inflow += event.amount;
    } else if (event.type === 'payout') {
      totals[month].outflow += event.amount;
    }
  }
  return totals;
}
