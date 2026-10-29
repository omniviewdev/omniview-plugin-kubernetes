import { ClipboardText } from '@omniviewdev/base-ui';

export const CopyableCell = ({ getValue }: { getValue: () => unknown }) => {
  const val = getValue();
  if (val == null || val === '' || val === '—') return <>{val == null ? '' : (val as string)}</>;
  const str = typeof val === 'string' ? val : JSON.stringify(val);
  return <ClipboardText value={str} />;
};

export default CopyableCell;
