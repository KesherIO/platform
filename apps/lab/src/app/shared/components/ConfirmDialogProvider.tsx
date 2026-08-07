import {
  createContext,
  useCallback,
  useContext,
  useState,
  ReactNode,
} from 'react';
import { ConfirmDialog, ConfirmDialogRequest } from './ConfirmDialog';

export interface ConfirmOptions extends ConfirmDialogRequest {
  /**
   * Optional async action to run when the user clicks Confirm. While it's
   * pending, the dialog shows a loading state and disables both buttons —
   * it only closes once the action settles. If it throws, the promise
   * returned by `confirm()` rejects with the same error so the caller can
   * show a toast; nothing here swallows it.
   */
  onConfirm?: () => Promise<unknown> | void;
}

type PendingConfirm = ConfirmOptions & {
  resolve: (confirmed: boolean) => void;
  reject: (error: unknown) => void;
};

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmDialogContext = createContext<ConfirmFn | null>(null);

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve, reject) => {
      setPending({ ...options, resolve, reject });
    });
  }, []);

  const handleCancel = () => {
    if (submitting || !pending) return;
    pending.resolve(false);
    setPending(null);
  };

  const handleConfirm = async () => {
    if (!pending) return;

    if (!pending.onConfirm) {
      pending.resolve(true);
      setPending(null);
      return;
    }

    setSubmitting(true);
    try {
      await pending.onConfirm();
      pending.resolve(true);
      setPending(null);
    } catch (err) {
      pending.reject(err);
      setPending(null);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ConfirmDialogContext.Provider value={confirm}>
      {children}
      {pending && (
        <ConfirmDialog
          title={pending.title}
          message={pending.message}
          confirmLabel={pending.confirmLabel}
          cancelLabel={pending.cancelLabel}
          variant={pending.variant}
          icon={pending.icon}
          submitting={submitting}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}
    </ConfirmDialogContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmDialogContext);
  if (!ctx) {
    throw new Error('useConfirm must be used within a ConfirmDialogProvider');
  }
  return ctx;
}
