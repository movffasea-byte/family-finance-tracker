// Pure split maths, no database. Works in integer kobo so nothing is summed as floats.
//
// proposeSplit(incomeNaira, rules) -> { lines: [{ pocketId, amount }], unassigned }
// rules: [{ pocketId, method: 'fixed' | 'percent', value, priority }]
//
// Fixed rules run first (ascending priority), each capped at what is left. Percent rules then
// share what is left after the fixed rules, each rounded down. Anything left stays unassigned
// (it stays in Ready to assign).

const toKobo = (naira) => Math.round(naira * 100);
const toNaira = (kobo) => kobo / 100;

export function proposeSplit(incomeNaira, rules = []) {
  const income = toKobo(incomeNaira);
  let remaining = Math.max(0, income);
  const byPriority = (a, b) => a.priority - b.priority;
  const lines = [];

  for (const rule of rules.filter((r) => r.method === 'fixed').sort(byPriority)) {
    const line = Math.min(toKobo(rule.value), remaining);
    remaining -= line;
    if (line > 0) lines.push({ pocketId: rule.pocketId, kobo: line });
  }

  const base = remaining;
  for (const rule of rules.filter((r) => r.method === 'percent').sort(byPriority)) {
    // base * percent / 100, in whole kobo, rounded down. BigInt keeps large amounts exact.
    const hundredths = Math.round(rule.value * 100);
    const share = Number((BigInt(base) * BigInt(hundredths)) / 10000n);
    const line = Math.min(share, remaining);
    remaining -= line;
    if (line > 0) lines.push({ pocketId: rule.pocketId, kobo: line });
  }

  const total = lines.reduce((sum, l) => sum + l.kobo, 0) + remaining;
  if (total !== Math.max(0, income)) throw new Error('Split does not add up to the income');

  return {
    lines: lines.map((l) => ({ pocketId: l.pocketId, amount: toNaira(l.kobo) })),
    unassigned: toNaira(remaining),
  };
}
