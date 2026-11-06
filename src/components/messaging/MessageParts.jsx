import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, Paperclip, Phone, RefreshCw, Search, Send } from 'lucide-react';
import Alert from '../common/Alert';
import Button from '../common/Button';
import { FileMessage } from '../files/FileParts';
import { EmployeeAvatar } from '../workspace/EmployeeParts';
import { ListSkeleton } from '../workspace/PageParts';
import { FILE_INPUT_ACCEPT } from '../../config/fileTypes';
import { MAX_MESSAGE_LENGTH } from '../../services/messagingService';
import { formatDateTime, formatDay, formatTime } from '../../utils/format';
import './messaging.css';

const NEAR_BOTTOM_PX = 120;
const SEARCH_DELAY_MS = 300;

export function Composer({ disabled, onSend, onAttach, placeholder = 'Write a message…' }) {
  const [value, setValue] = useState('');
  const inputRef = useRef(null);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight + 2}px`;
  }, [value]);

  const canSend = value.trim().length > 0 && !disabled;

  const submit = () => {
    if (!canSend) return;
    onSend(value.trim());
    setValue('');
    inputRef.current?.focus();
  };

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {onAttach && (
        <label className="composer__attach" title="Attach files">
          <span className="sr-only">Attach files</span>
          <Paperclip size={20} aria-hidden="true" />
          <input
            type="file"
            className="sr-only"
            multiple
            accept={FILE_INPUT_ACCEPT}
            disabled={disabled}
            onChange={(event) => {
              onAttach(event.target.files);
              event.target.value = '';
            }}
          />
        </label>
      )}
      <label className="sr-only" htmlFor="message-input">
        Message
      </label>
      <textarea
        ref={inputRef}
        id="message-input"
        className="composer__input"
        rows={1}
        placeholder={placeholder}
        maxLength={MAX_MESSAGE_LENGTH}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          // Enter sends, Shift+Enter makes a new line. Enter during IME input does neither.
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            submit();
          }
        }}
      />
      <button type="submit" className="composer__send" aria-label="Send message" disabled={!canSend}>
        <Send size={18} aria-hidden="true" />
      </button>
    </form>
  );
}

/** Searches one thread. `search(query)` returns matching messages, newest first. */
export function ThreadSearch({ search, label = 'Search this conversation', onClose }) {
  const [query, setQuery] = useState('');
  const [state, setState] = useState({ status: 'idle', results: [], error: '' });

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setState({ status: 'idle', results: [], error: '' });
      return undefined;
    }
    let isActive = true;
    setState((current) => ({ ...current, status: 'searching' }));
    const timer = setTimeout(async () => {
      try {
        const results = (await search(trimmed)) ?? [];
        if (isActive) setState({ status: 'ready', results, error: '' });
      } catch (error) {
        if (isActive) setState({ status: 'error', results: [], error: error?.message || 'Search failed.' });
      }
    }, SEARCH_DELAY_MS);
    return () => {
      isActive = false;
      clearTimeout(timer);
    };
  }, [query, search]);

  return (
    <div className="thread-search">
      <div className="filter-input">
        <Search size={16} aria-hidden="true" />
        <input
          type="search"
          autoFocus
          placeholder={label}
          aria-label={label}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose();
          }}
        />
      </div>
      {state.status === 'error' && <Alert variant="error">{state.error}</Alert>}
      {state.status === 'ready' && !state.results.length && (
        <p className="thread-search__empty">No messages match your search.</p>
      )}
      {state.results.length > 0 && (
        <ul className="thread-search__results">
          {state.results.map((result) => (
            <li key={result.id}>
              <p className="thread-search__text">{result.content}</p>
              <p className="row__meta">
                {result.sender_full_name ? `${result.sender_full_name} · ` : ''}
                {formatDateTime(result.created_at)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The scrolling list of messages shared by direct chats and channels.
 *   senderOf(message)   the employee who sent it
 *   labelFor(message)   optional status under the message, such as "Read"
 *   files               from useMessageFiles: the file behind each file message
 */
export function MessageList({ thread, userId, senderOf, labelFor, emptyState, onActivity, files }) {
  const { messages } = thread;
  const scrollRef = useRef(null);
  const isNearBottom = useRef(true);
  const preserveFrom = useRef(null);
  const lastKey = useRef(null);
  const [hasNewBelow, setHasNewBelow] = useState(false);

  const scrollToBottom = useCallback(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
    isNearBottom.current = true;
    setHasNewBelow(false);
  }, []);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    // Older messages were added above: keep the reader where they were.
    if (preserveFrom.current !== null) {
      element.scrollTop = element.scrollHeight - preserveFrom.current;
      preserveFrom.current = null;
      return;
    }

    const newest = messages[messages.length - 1];
    const newestKey = newest ? newest.client_id ?? newest.id : null;
    if (newestKey === lastKey.current) return;
    const isFirstLoad = lastKey.current === null;
    lastKey.current = newestKey;

    if (isFirstLoad || isNearBottom.current || newest?.sender_id === userId) scrollToBottom();
    else setHasNewBelow(true);
  }, [messages, scrollToBottom, userId]);

  const handleScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    isNearBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < NEAR_BOTTOM_PX;
    if (isNearBottom.current) setHasNewBelow(false);
  };

  const handleLoadOlder = async () => {
    const element = scrollRef.current;
    preserveFrom.current = element ? element.scrollHeight - element.scrollTop : null;
    await thread.loadOlder();
  };

  // The list of threads alongside follows anything that happens here.
  useEffect(() => {
    onActivity?.();
  }, [messages.length, onActivity]);

  return (
    <div className="thread__body">
      <div className="thread__scroll" ref={scrollRef} onScroll={handleScroll}>
        {thread.status === 'loading' && <ListSkeleton rows={4} />}

        {thread.status === 'error' && (
          <div className="page__stack thread__notice">
            <Alert variant="error" title="Couldn’t load messages">
              {thread.error}
            </Alert>
            <div>
              <Button
                variant="outline"
                onClick={() => thread.reload()}
                leftIcon={<RefreshCw size={16} aria-hidden="true" />}
              >
                Try again
              </Button>
            </div>
          </div>
        )}

        {thread.status === 'ready' && !messages.length && emptyState}

        {thread.hasOlder && (
          <div className="page__more thread__older">
            <Button variant="outline" onClick={handleLoadOlder} isLoading={thread.isLoadingOlder} loadingText="Loading…">
              Load earlier messages
            </Button>
          </div>
        )}

        <ol className="message-list">
          {messages.map((message, index) => {
            const previous = messages[index - 1];
            const day = formatDay(message.created_at);
            const isNewDay = !previous || formatDay(previous.created_at) !== day;
            const isOwn = message.sender_id === userId;
            const isGrouped =
              !isNewDay && previous?.sender_id === message.sender_id && previous?.message_type !== 'call';
            const sender = senderOf(message);
            const label = labelFor?.(message) ?? '';

            if (message.message_type === 'call') {
              return (
                <li key={message.id} className="message-item">
                  {isNewDay && (
                    <p className="day-divider">
                      <span>{day}</span>
                    </p>
                  )}
                  <p className="call-entry">
                    <Phone size={14} aria-hidden="true" /> {message.content} ·{' '}
                    <time dateTime={message.created_at}>{formatTime(message.created_at)}</time>
                  </p>
                </li>
              );
            }

            return (
              <li key={message.client_id ?? message.id} className="message-item">
                {isNewDay && (
                  <p className="day-divider">
                    <span>{day}</span>
                  </p>
                )}
                <div className={`message${isOwn ? ' message--own' : ''}${isGrouped ? ' is-grouped' : ''}`}>
                  {!isOwn && (
                    <span className="message__avatar">
                      {!isGrouped && <EmployeeAvatar employee={sender} size={32} />}
                    </span>
                  )}
                  <div className="message__content">
                    {!isGrouped && (
                      <p className="message__meta">
                        <strong>{isOwn ? 'You' : sender.full_name}</strong>
                      </p>
                    )}
                    {message.message_type === 'file' ? (
                      <div className="message-file">
                        <FileMessage
                          file={files?.files[message.id]}
                          isLoading={files?.files[message.id] === undefined}
                          onDeleted={() => files?.markDeleted(message.id)}
                        />
                      </div>
                    ) : (
                      <p className={`message__bubble${message.failed ? ' is-failed' : ''}`}>{message.content}</p>
                    )}
                    <p className="message__meta">
                      <time dateTime={message.created_at}>{formatTime(message.created_at)}</time>
                      {label && <span> · {label}</span>}
                    </p>
                    {message.failed && (
                      <p className="message__failure" role="alert">
                        {message.failure}{' '}
                        <button type="button" className="link-button" onClick={() => thread.retry(message)}>
                          Try again
                        </button>{' '}
                        <button type="button" className="link-button" onClick={() => thread.discard(message)}>
                          Discard
                        </button>
                      </p>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      {hasNewBelow && (
        <button type="button" className="new-below" onClick={scrollToBottom}>
          <ArrowDown size={15} aria-hidden="true" /> New messages
        </button>
      )}
    </div>
  );
}
