import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Download,
  ExternalLink,
  File as FileIcon,
  FileSpreadsheet,
  FileText,
  FileX,
  Image as ImageIcon,
  Presentation,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import Alert from '../common/Alert';
import Button from '../common/Button';
import { ConfirmDialog, ListSkeleton } from '../workspace/PageParts';
import { canOpenInBrowser, formatFileSize, isImageType } from '../../config/fileTypes';
import { useWorkspace } from '../../context/WorkspaceContext';
import { usePagedList } from '../../hooks/usePagedList';
import { deleteSharedFile, downloadFile, FILE_PAGE_SIZE, getPreviewUrl, listSharedFiles, openFile } from '../../services/fileService';
import { formatDateTime } from '../../utils/format';
import './files.css';

function iconFor(mimeType = '') {
  if (isImageType(mimeType)) return ImageIcon;
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType === 'text/csv') return FileSpreadsheet;
  if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return Presentation;
  if (mimeType.includes('word') || mimeType === 'application/pdf' || mimeType === 'text/plain') return FileText;
  return FileIcon;
}

function locationLink(file) {
  if (file.channel_id) return `/channels/${file.channel_id}`;
  return file.location_type === 'group' ? `/groups/${file.conversation_id}` : `/messages/${file.conversation_id}`;
}

function ImagePreview({ file }) {
  const [state, setState] = useState({ url: '', failed: false });

  useEffect(() => {
    let isActive = true;
    getPreviewUrl(file)
      .then((url) => {
        if (isActive) setState({ url, failed: false });
      })
      .catch(() => {
        if (isActive) setState({ url: '', failed: true });
      });
    return () => {
      isActive = false;
    };
  }, [file]);

  if (state.failed) return null;
  return (
    <div className="file-card__preview">
      {state.url ? (
        <img className="file-card__image" src={state.url} alt={file.file_name} loading="lazy" />
      ) : (
        <div className="file-card__image file-card__image--loading" aria-hidden="true" />
      )}
    </div>
  );
}

/** PDF, DOCX and so on, from the name, since the stored types are long and technical. */
const typeLabel = (name) => (name.includes('.') ? name.split('.').pop().toUpperCase() : 'File');

/**
 * A shared file, with what the viewer is allowed to do with it. In a chat the message
 * already shows who sent it and when, so `compact` leaves those out of the card.
 */
export function FileCard({ file, showImage = true, showLocation = false, compact = false, onDeleted }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [isConfirming, setIsConfirming] = useState(false);
  const Icon = iconFor(file.mime_type);

  const run = async (name, action) => {
    setBusy(name);
    setError('');
    try {
      await action();
    } catch (actionError) {
      setError(actionError?.message || 'Something went wrong. Please try again.');
    } finally {
      setBusy('');
    }
  };

  const confirmDelete = async () => {
    setBusy('delete');
    setError('');
    try {
      await deleteSharedFile(file.id);
      setIsConfirming(false);
      onDeleted?.(file);
    } catch (deleteError) {
      setError(deleteError?.message || 'Something went wrong. Please try again.');
      setIsConfirming(false);
      setBusy('');
    }
  };

  return (
    <div className="file-card">
      {showImage && isImageType(file.mime_type) && <ImagePreview file={file} />}
      <div className="file-card__main">
        <span className="file-card__icon">
          <Icon size={20} aria-hidden="true" />
        </span>
        <div className="file-card__body">
          <p className="file-card__name">{file.file_name}</p>
          <p className="row__meta">
            {typeLabel(file.file_name)} · {formatFileSize(file.file_size)}
            {!compact && (
              <>
                {file.uploader_name ? ` · ${file.uploader_name}` : ''} · {formatDateTime(file.created_at)}
              </>
            )}
          </p>
          {showLocation && (
            <p className="row__meta">
              In{' '}
              <Link to={locationLink(file)}>
                {file.location_type === 'direct' ? `chat with ${file.location_name ?? 'a former employee'}` : file.location_name}
              </Link>
            </p>
          )}
        </div>
        <div className="file-card__actions">
          {canOpenInBrowser(file.mime_type) && (
            <button
              type="button"
              className="icon-button"
              aria-label={`Open ${file.file_name}`}
              title="Open in a new tab"
              disabled={Boolean(busy)}
              onClick={() => run('open', () => openFile(file))}
            >
              <ExternalLink size={18} aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            className="icon-button"
            aria-label={`Download ${file.file_name}`}
            title="Download"
            disabled={Boolean(busy)}
            onClick={() => run('download', () => downloadFile(file))}
          >
            <Download size={18} aria-hidden="true" />
          </button>
          {file.can_delete && (
            <button
              type="button"
              className="icon-button"
              aria-label={`Delete ${file.file_name}`}
              title="Delete"
              disabled={Boolean(busy)}
              onClick={() => setIsConfirming(true)}
            >
              <Trash2 size={18} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      {error && (
        <p className="file-card__error" role="alert">
          {error}
        </p>
      )}
      {isConfirming && (
        <ConfirmDialog
          title="Delete this file?"
          confirmLabel="Delete file"
          isBusy={busy === 'delete'}
          onCancel={() => setIsConfirming(false)}
          onConfirm={confirmDelete}
        >
          “{file.file_name}” will be permanently deleted for everyone. This can’t be undone.
        </ConfirmDialog>
      )}
    </div>
  );
}

/** What a file message shows: the file, or a note that it has gone. */
export function FileMessage({ file, isLoading, onDeleted }) {
  if (isLoading) return <div className="file-card file-card--placeholder" role="status" aria-label="Loading file" />;
  if (!file) {
    return (
      <p className="file-card file-card--deleted">
        <FileX size={16} aria-hidden="true" /> This file was deleted.
      </p>
    );
  }
  return <FileCard file={file} compact onDeleted={onDeleted} />;
}

/** Files on their way into a thread. */
export function UploadQueue({ uploads, onRetry, onCancel, onDismiss }) {
  if (!uploads.length) return null;

  return (
    <ul className="upload-queue" aria-label="File uploads">
      {uploads.map((item) => (
        <li key={item.id} className={`upload-item${item.status === 'failed' ? ' is-failed' : ''}`}>
          <div className="upload-item__row">
            <span className="upload-item__name">{item.file.name}</span>
            <span className="row__meta">{formatFileSize(item.file.size)}</span>
            {item.status === 'failed' && item.canRetry && (
              <button
                type="button"
                className="icon-button upload-item__button"
                aria-label={`Try uploading ${item.file.name} again`}
                onClick={() => onRetry(item)}
              >
                <RefreshCw size={15} aria-hidden="true" />
              </button>
            )}
            {item.status !== 'sharing' && (
              <button
                type="button"
                className="icon-button upload-item__button"
                aria-label={item.status === 'failed' ? `Dismiss ${item.file.name}` : `Cancel uploading ${item.file.name}`}
                onClick={() => (item.status === 'failed' ? onDismiss(item) : onCancel(item))}
              >
                <X size={15} aria-hidden="true" />
              </button>
            )}
          </div>
          {item.status === 'failed' ? (
            <p className="upload-item__error" role="alert">
              {item.error}
            </p>
          ) : (
            <div
              className="upload-item__bar"
              role="progressbar"
              aria-label={`Uploading ${item.file.name}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(item.progress * 100)}
            >
              <span style={{ width: `${Math.round(item.progress * 100)}%` }} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Accepts files dragged onto a thread. Does nothing when the thread takes no uploads. */
export function useFileDrop(onFiles, isEnabled) {
  const [isDragging, setIsDragging] = useState(false);

  if (!isEnabled) return { isDragging: false, dropProps: {} };

  const hasFiles = (event) => Array.from(event.dataTransfer?.types ?? []).includes('Files');

  return {
    isDragging,
    dropProps: {
      onDragOver: (event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        setIsDragging(true);
      },
      onDragLeave: (event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setIsDragging(false);
      },
      onDrop: (event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        setIsDragging(false);
        onFiles(event.dataTransfer.files);
      },
    },
  };
}

export function DropOverlay() {
  return (
    <div className="drop-overlay" aria-hidden="true">
      <Upload size={28} />
      <span>Drop files to share them here</span>
    </div>
  );
}

/** The files shared in one conversation or channel, for its details panel. */
export function SharedFilesSection({ conversationId, channelId }) {
  const { subscribeToMessages } = useWorkspace();
  const fetchPage = useCallback(
    (page) => listSharedFiles({ conversationId, channelId, ...page }),
    [conversationId, channelId],
  );
  const list = usePagedList(fetchPage, conversationId ?? channelId, FILE_PAGE_SIZE);
  const { refresh } = list;

  useEffect(
    () =>
      subscribeToMessages(({ type, row }) => {
        if (row.message_type !== 'file') return;
        if (type === 'message' && row.conversation_id === conversationId) refresh();
        if (type === 'channel_message' && row.channel_id === channelId) refresh();
      }),
    [subscribeToMessages, conversationId, channelId, refresh],
  );

  return (
    <section aria-label="Shared files">
      <h3 className="channel-members__title">Shared files</h3>
      {list.status === 'loading' && <ListSkeleton rows={2} />}
      {list.status === 'error' && <Alert variant="error">{list.error}</Alert>}
      {list.status === 'ready' && !list.items.length && <p className="row__meta">No files have been shared yet.</p>}
      <ul className="shared-files">
        {list.items.map((file) => (
          <li key={file.id}>
            <FileCard file={file} showImage={false} onDeleted={() => list.removeItem(file.id)} />
          </li>
        ))}
      </ul>
      {list.hasMore && (
        <div className="page__more">
          <Button variant="ghost" onClick={list.loadMore} isLoading={list.status === 'loadingMore'} loadingText="Loading…">
            Show more files
          </Button>
        </div>
      )}
    </section>
  );
}
