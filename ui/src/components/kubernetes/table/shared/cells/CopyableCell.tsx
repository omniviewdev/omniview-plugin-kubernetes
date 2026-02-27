import { ClipboardText } from '@omniviewdev/ui';

export const CopyableCell = ({ getValue }: { getValue: () => unknown }) => {
  const val = getValue();
  if (val == null || val === '' || val === '—') return <>{val == null ? '' : (val as string)}</>;
  const str = typeof val === 'object' ? JSON.stringify(val) : String(val as string | number | boolean);
  return <ClipboardText value={str} variant="inherit" />;
};

export default CopyableCell;
