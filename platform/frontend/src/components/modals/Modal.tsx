import React, { useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  className?: string;
  overlayClassName?: string;
  contentClassName?: string;
  headerClassName?: string;
  bodyClassName?: string;
  footer?: React.ReactNode;
  closeOnOverlayClick?: boolean;
  closeOnEscape?: boolean;
  showCloseButton?: boolean;
  closeButtonClassName?: string;
  id?: string;
}

// Type for modal methods exposed via ref
export interface ModalMethods {
  open: () => void;
  close: () => void;
  toggle: () => void;
}

export const Modal = forwardRef<ModalMethods, ModalProps>(
  (
    {
      isOpen,
      onClose,
      title,
      description,
      children,
      size = 'md',
      className = '',
      overlayClassName = '',
      contentClassName = '',
      headerClassName = '',
      bodyClassName = '',
      footer,
      closeOnOverlayClick = true,
      closeOnEscape = true,
      showCloseButton = true,
      closeButtonClassName = '',
      id,
    },
    ref
  ) => {
    const handleEscape = useCallback(
      (event: KeyboardEvent) => {
        if (closeOnEscape && event.key === 'Escape') {
          onClose();
        }
      },
      [closeOnEscape, onClose]
    );

    useEffect(() => {
      if (isOpen) {
        document.addEventListener('keydown', handleEscape);
        document.body.style.overflow = 'hidden';
      }

      return () => {
        document.removeEventListener('keydown', handleEscape);
        document.body.style.overflow = 'unset';
      };
    }, [isOpen, handleEscape]);

    // Expose modal methods via ref
    useImperativeHandle(
      ref,
      () => ({
        open: () => {},
        close: () => onClose(),
        toggle: () => {},
      }),
      [onClose]
    );

    if (!isOpen) {
      return null;
    }

    const handleOverlayClick = (event: React.MouseEvent<HTMLDivElement>) => {
      if (closeOnOverlayClick && event.target === event.currentTarget) {
        onClose();
      }
    };

    const sizeClasses = {
      sm: 'max-w-sm',
      md: 'max-w-md',
      lg: 'max-w-lg',
      xl: 'max-w-xl',
      full: 'max-w-[90vw] max-h-[90vh]',
    };

    const modalContent = (
      <div
        className={cn(
          'fixed inset-0 z-50 flex items-center justify-center p-4',
          overlayClassName
        )}
        onClick={handleOverlayClick}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? `${id || 'modal'}-title` : undefined}
        aria-describedby={description ? `${id || 'modal'}-description` : undefined}
      >
        {/* Overlay */}
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
          aria-hidden="true"
        />

        {/* Modal Container */}
        <div
          className={cn(
            'relative w-full bg-background rounded-lg shadow-xl animate-in zoom-in-95 duration-200',
            sizeClasses[size],
            contentClassName
          )}
        >
          {/* Header */}
          {(title || showCloseButton) && (
            <div
              className={cn(
                'flex items-center justify-between p-6 border-b border-border',
                headerClassName
              )}
            >
              <div>
                {title && (
                  <h2
                    id={`${id || 'modal'}-title`}
                    className="text-lg font-semibold text-foreground"
                  >
                    {title}
                  </h2>
                )}
                {description && (
                  <p
                    id={`${id || 'modal'}-description`}
                    className="text-sm text-muted-foreground mt-1"
                  >
                    {description}
                  </p>
                )}
              </div>
              {showCloseButton && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={cn(
                    'p-1 -mr-2 -mt-1 h-8 w-8 rounded-full hover:bg-destructive/10 hover:text-destructive',
                    closeButtonClassName
                  )}
                  onClick={onClose}
                  aria-label="Close modal"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          )}

          {/* Body */}
          <div
            className={cn(
              'p-6 max-h-[70vh] overflow-y-auto',
              !title && !showCloseButton && 'pt-6',
              bodyClassName
            )}
          >
            {children}
          </div>

          {/* Footer */}
          {footer && (
            <div className="p-6 border-t border-border">
              {footer}
            </div>
          )}
        </div>
      </div>
    );

    // Use portal to render modal at the end of document body
    return createPortal(modalContent, document.body);
  }
);

Modal.displayName = 'Modal';

// Type-safe Modal component with ref support
export function createModal(
  props: ModalProps & { ref?: React.Ref<ModalMethods> }
): React.ReactElement {
  return <Modal {...props} />;
}

export default Modal;
