import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import TimeSeriesChart from './TimeSeriesChart';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function renderBars(values: number[]) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 400, height: 180, top: 0, left: 0, right: 400, bottom: 180, x: 0, y: 0, toJSON: () => ({}) });
  const from = Date.parse('2026-11-04T12:00:00Z');
  const { container } = render(<TimeSeriesChart bars height={180} timeRange={{ from: new Date(from), to: new Date(from + 3_600_000) }} series={[{ id: 'samples', label: 'Samples', data: values.map((value, index) => ({ timestamp: from + 1_800_000 + index * 30_000, value })) }]} />);
  return { plot: container.querySelector('clipPath rect')!, bars: [...container.querySelectorAll('g[clip-path] > rect')] };
}

it('does not spread one isolated sample across its otherwise empty time window', () => {
  const { plot, bars } = renderBars([5]);
  expect(bars).toHaveLength(1);
  expect(Number(bars[0].getAttribute('width'))).toBeGreaterThan(0);
  expect(Number(bars[0].getAttribute('width'))).toBeLessThan(Number(plot.getAttribute('width')) / 10);
});

it('keeps negative-only sample bars inside the plot with a visible zero baseline', () => {
  const { plot, bars } = renderBars([-5, -10]);
  expect(bars).toHaveLength(2);
  const top = Number(plot.getAttribute('y'));
  const bottom = top + Number(plot.getAttribute('height'));
  for (const bar of bars) {
    const y = Number(bar.getAttribute('y'));
    const height = Number(bar.getAttribute('height'));
    expect(height).toBeGreaterThan(0);
    expect(y).toBeGreaterThanOrEqual(top);
    expect(y + height).toBeLessThanOrEqual(bottom);
  }
});

it('keeps SVG and path nodes during background loading and updates geometry in place', () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 400, height: 180, top: 0, left: 0, right: 400, bottom: 180, x: 0, y: 0, toJSON: () => ({}) });
  const series = [{ id: 'cpu', label: 'CPU', data: [{ timestamp: 0, value: 1 }, { timestamp: 30_000, value: 2 }] }];
  const { container, rerender, getByRole } = render(<TimeSeriesChart series={series} />);
  const svg = getByRole('img');
  const path = container.querySelector('g[clip-path] path')!;
  const before = path.getAttribute('d');
  rerender(<TimeSeriesChart series={series} loading />);
  expect(getByRole('img')).toBe(svg);
  expect(container.querySelector('g[clip-path] path')).toBe(path);
  expect(path.getAttribute('d')).toBe(before);
  rerender(<TimeSeriesChart series={[{ ...series[0], data: [{ timestamp: 0, value: 3 }, { timestamp: 30_000, value: 1 }] }]} />);
  expect(getByRole('img')).toBe(svg);
  expect(container.querySelector('g[clip-path] path')).toBe(path);
  expect(path.getAttribute('d')).not.toBe(before);
  rerender(<TimeSeriesChart series={series} error="Refresh failed" />);
  expect(getByRole('img')).toBe(svg);
  expect(getByRole('alert').textContent).toBe('Refresh failed');
});

it('shows genuine empty and initial error states without retaining a chart', () => {
  const { container, rerender, getByText } = render(<TimeSeriesChart series={[]} />);
  expect(getByText('No data')).toBeTruthy();
  expect(container.querySelector('svg[role="img"]')).toBeNull();
  rerender(<TimeSeriesChart series={[]} error="Provider denied" />);
  expect(getByText('Provider denied')).toBeTruthy();
  expect(container.querySelector('svg[role="img"]')).toBeNull();
});
