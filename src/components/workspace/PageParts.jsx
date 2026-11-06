import { useEffect, useRef } from 'react';
import { RefreshCw } from 'lucide-react';
import Alert from '../common/Alert';
import Button from '../common/Button';

export function PageHeader({ title, subtitle, children }) {
  return (
    <header className="page__header">
      <div>
        <h1 className="page__title">{title}</h1>
        {subtitle && <p className="page__subtitle">{subtitle}</p>}
      </div>
      {children}
    </header>
  );
}

export function EmptyState({ icon: Icon, title, children }) {
  return (
    <div className="empty">
      {Icon && (
        <span className="empty__icon">
          <Icon size={26} aria-hidden="true" />
        </span>
      )}
      <h2 className="empty__title">{title}</h2>
      {children && <p>{children}</p>}
    </div>
  );
}

export function ListSkeleton({ rows = 5 }) {
  return (
    <div className="skeleton-list" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="skeleton-row">
          <span className="skeleton skeleton--avatar" />
          <span className="skeleton-row__lines">
            <span className="skeleton skeleton--line" />
            <span className="skeleton skeleton--line skeleton--short" />
          </span>
        </div>
      ))}
    </div>
  );
}

/** Shows loading, error and "load more" around a list from usePagedList. */
export function PagedList({ list, emptyState, children }) {
  if (list.status === 'loading') return <ListSkeleton />;
  if (list.status === 'error' && !list.items.length) {
    return (
      <div className="page__stack">
        <Alert variant="error" title="Couldn’t load this page">
          {list.error}
        </Alert>
        <div>
          <Button variant="outline" onClick={list.reload} leftIcon={<RefreshCw size={16} aria-hidden="true" />}>
            Try again
          </Button>
        </div>
      </div>
    );
  }
  if (!list.items.length) return emptyState;

  return (
    <div className="page__stack">
      <ul className="row-list">{children}</ul>
      {list.status === 'error' && <Alert variant="error">{list.error}</Alert>}
      {list.hasMore && (
        <div className="page__more">
          <Button
            variant="outline"
            onClick={list.loadMore}
            isLoading={list.status === 'loadingMore'}
            loadingText="Loading…"
          >
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}

/** A modal using the native dialog, which handles focus and Esc. */
export function Modal({ title, children, onCancel }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="dialog"
      aria-labelledby="dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <h2 id="dialog-title" className="dialog__title">
        {title}
      </h2>
      {children}
    </dialog>
  );
}

/** Asks before something hard to undo. */
export function ConfirmDialog({ title, children, confirmLabel, onConfirm, onCancel, isBusy }) {
  return (
    <Modal title={title} onCancel={onCancel}>
      <p>{children}</p>
      <div className="dialog__actions">
        <Button variant="outline" onClick={onCancel} disabled={isBusy}>
          Cancel
        </Button>
        <Button onClick={onConfirm} isLoading={isBusy} loadingText="Working…">
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
