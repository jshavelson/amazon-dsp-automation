import React, { useState, useImperativeHandle, forwardRef } from 'react';
import { Button } from '@/components/ui/button';
import { Modal, ModalProps, createModal } from './Modal';

export interface ConfirmModalProps extends Omit<ModalProps, 'children' | 'footer'> {
  confirmText?: string;
  cancelText?: string;
  confirmVariant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
  cancelVariant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
  confirmDisabled?: boolean;
  cancelDisabled?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void;
  loading?: boolean;
  icon?: React.ReactNode;
}

// Type for confirm modal methods
interface ConfirmModalMethods {
  open: () => void;
  close: () => void;
  confirm: () => void;
}

const ConfirmModal = forwardRef<ConfirmModalMethods, ConfirmModalProps>(
  (
    {
      isOpen,
      onClose,
      title = 'Confirm Action',
      description,
      confirmText = 'Confirm',
      cancelText = 'Cancel',
      confirmVariant = 'default',
      cancelVariant = 'outline',
      confirmDisabled = false,
      cancelDisabled = false,
      onConfirm,
      onCancel,
      loading = false,
      icon,
      ...props
    },
    ref
  ) => {
    const [isLoading, setIsLoading] = useState(loading);

    const handleConfirm = async () => {
      setIsLoading(true);
      try {
        await onConfirm();
        onClose();
      } finally {
        setIsLoading(false);
      }
    };

    const handleCancel = () => {
      onCancel?.();
      onClose();
    };

    // Expose methods via ref
    useImperativeHandle(
      ref,
      () => ({
        open: () => {},
        close: () => onClose(),
        confirm: handleConfirm,
      }),
      [onClose, handleConfirm]
    );

    const footer = (
      <div className="flex gap-3 justify-end">
        <Button
          type="button"
          variant={cancelVariant}
          onClick={handleCancel}
          disabled={cancelDisabled || isLoading}
        >
          {cancelText}
        </Button>
        <Button
          type="button"
          variant={confirmVariant}
          onClick={handleConfirm}
          disabled={confirmDisabled || isLoading}
          loading={isLoading}
        >
          {confirmText}
        </Button>
      </div>
    );

    return (
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={title}
        description={description}
        footer={footer}
        {...props}
      >
        {icon && <div className="flex justify-center mb-4">{icon}</div>}
      </Modal>
    );
  }
);

ConfirmModal.displayName = 'ConfirmModal';

// Type-safe ConfirmModal with ref support
export function createConfirmModal(
  props: ConfirmModalProps & { ref?: React.Ref<ConfirmModalMethods> }
): React.ReactElement {
  return <ConfirmModal {...props} />;
}

// Pre-configured confirm modal variants
export function createDangerConfirmModal(
  props: Omit<ConfirmModalProps, 'confirmVariant' | 'confirmText'> & {
    ref?: React.Ref<ConfirmModalMethods>;
  }
): React.ReactElement {
  return (
    <ConfirmModal
      {...props}
      confirmVariant="destructive"
      confirmText="Delete"
    />
  );
}

export function createSuccessConfirmModal(
  props: Omit<ConfirmModalProps, 'confirmVariant'> & {
    ref?: React.Ref<ConfirmModalMethods>;
  }
): React.ReactElement {
  return <ConfirmModal {...props} confirmVariant="default" />;
}

export default ConfirmModal;
