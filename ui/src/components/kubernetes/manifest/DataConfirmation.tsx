import { AlertDialog, Button } from '@omniviewdev/base-ui';
import { useContext } from 'react';
import { ResourcePortalContext } from './ResourcePortalContext';
import styles from './DataForms.module.css';

export default function DataConfirmation({ open, title, description, onCancel, onConfirm }: {
  open: boolean; title: string; description: string; onCancel: () => void; onConfirm: () => void;
}) {
  const container = useContext(ResourcePortalContext);
  return <AlertDialog.Root open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
    <AlertDialog.Portal container={container}><AlertDialog.Backdrop className={styles.backdrop} /><AlertDialog.Popup className={styles.confirmation}>
      <AlertDialog.Title>{title}</AlertDialog.Title><AlertDialog.Description>{description}</AlertDialog.Description>
      <div className={styles.actions}><Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button><Button size="sm" onClick={onConfirm}>Confirm</Button></div>
    </AlertDialog.Popup></AlertDialog.Portal>
  </AlertDialog.Root>;
}
