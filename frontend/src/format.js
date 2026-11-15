const naira = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  maximumFractionDigits: 2,
});

export const money = (n) => naira.format(n ?? 0);

export const monthName = (month, year) =>
  new Date(year, month - 1, 1).toLocaleString('en-NG', { month: 'long', year: 'numeric' });

export const shortDate = (iso) =>
  new Date(iso + 'T00:00:00').toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
