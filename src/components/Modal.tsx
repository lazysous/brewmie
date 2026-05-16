import React, { useEffect, useRef } from 'react'
import { useTranslation } from '../hooks/useTranslation'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  /** 'sheet' slides up from bottom (default); 'center' floats centered */
  variant?: 'sheet' | 'center'
  /** If true, clicking the backdrop does not close the modal */
  preventBackdropClose?: boolean
}

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  variant = 'sheet',
  preventBackdropClose = false,
}: ModalProps) {
  const { t } = useTranslation()
  const dialogRef = useRef<HTMLDivElement>(null)

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [isOpen, onClose])

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (preventBackdropClose) return
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div
      className={`modal-backdrop modal-backdrop--${variant}`}
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        ref={dialogRef}
        className={`modal modal--${variant}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? 'modal-title' : undefined}
      >
        {(title || !preventBackdropClose) && (
          <div className="modal__header">
            {variant === 'sheet' && (
              <div className="modal__drag-handle" aria-hidden="true" />
            )}
            {title && (
              <h2 id="modal-title" className="modal__title">
                {title}
              </h2>
            )}
            <button
              className="modal__close-btn"
              onClick={onClose}
              aria-label={t('modal.close')}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )}

        <div className="modal__body">{children}</div>
      </div>

      <style>{`
        .modal-backdrop {
          position: fixed;
          inset: 0;
          z-index: 100;
          display: flex;
          animation: backdropFadeIn 0.2s ease forwards;
        }

        .modal-backdrop--sheet {
          align-items: flex-end;
          justify-content: center;
          background: rgba(0, 0, 0, 0.5);
        }

        .modal-backdrop--center {
          align-items: center;
          justify-content: center;
          background: rgba(0, 0, 0, 0.5);
          padding: 16px;
        }

        @keyframes backdropFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        .modal {
          background: var(--white);
          width: 100%;
          max-width: var(--app-max-width);
          max-height: 90vh;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .modal--sheet {
          border-radius: var(--radius-lg) var(--radius-lg) 0 0;
          padding-bottom: var(--safe-bottom);
          animation: sheetSlideUp 0.28s cubic-bezier(0.32, 0.72, 0, 1) forwards;
        }

        .modal--center {
          border-radius: var(--radius-lg);
          max-height: 80vh;
          animation: centerScaleIn 0.2s ease forwards;
        }

        @keyframes sheetSlideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }

        @keyframes centerScaleIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }

        .modal__header {
          display: flex;
          align-items: center;
          padding: 12px 16px 8px;
          border-bottom: 1px solid var(--border-light);
          flex-shrink: 0;
          gap: 8px;
        }

        .modal__drag-handle {
          width: 36px;
          height: 4px;
          border-radius: var(--radius-full);
          background: var(--border);
          position: absolute;
          top: 10px;
          left: 50%;
          transform: translateX(-50%);
        }

        .modal__title {
          flex: 1;
          font-size: 17px;
          font-weight: 700;
          color: var(--text-primary);
          margin-top: 4px;
        }

        .modal__close-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          border-radius: var(--radius-full);
          background: var(--off-white);
          color: var(--grey-medium);
          flex-shrink: 0;
          transition: var(--transition);
        }

        .modal__close-btn:hover {
          background: var(--border-light);
          color: var(--text-primary);
        }

        .modal__body {
          overflow-y: auto;
          -webkit-overflow-scrolling: touch;
          flex: 1;
          padding: 16px;
        }
      `}</style>
    </div>
  )
}
