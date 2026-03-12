/** Format an ISO date as a short human-friendly string. */
export function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

/** Format a relative time like "3 months ago". */
export function relativeTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const now = Date.now();
    const diffMs = now - d.getTime();
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (days < 1) return 'today';
    if (days === 1) return '1 day ago';
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;
    const years = Math.floor(months / 12);
    return `${years}y ago`;
  } catch {
    return '';
  }
}
