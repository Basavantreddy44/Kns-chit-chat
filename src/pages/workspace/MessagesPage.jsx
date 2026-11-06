import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, useParams } from 'react-router-dom';
import { MessageSquare, MessageSquareOff, Search, X } from 'lucide-react';
import Alert from '../../components/common/Alert';
import { SharedFilesSection } from '../../components/files/FileParts';
import MessageThread, { toEmployee } from '../../components/messaging/MessageThread';
import { EmployeeAvatar } from '../../components/workspace/EmployeeParts';
import { EmptyState, ListSkeleton, PagedList } from '../../components/workspace/PageParts';
import { useAuth } from '../../context/AuthContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import { usePagedList } from '../../hooks/usePagedList';
import {
  CONVERSATION_PAGE_SIZE,
  getConversation,
  listConversations,
} from '../../services/messagingService';
import { formatRelativeDay } from '../../utils/format';
import '../../components/messaging/messaging.css';

const SEARCH_DELAY_MS = 300;
const LIST_REFRESH_DELAY_MS = 250;

function ConversationRow({ conversation, userId }) {
  const employee = toEmployee(conversation);
  const isOwnLast = conversation.last_sender_id === userId;

  return (
    <li>
      <NavLink
        to={`/messages/${conversation.id}`}
        className={({ isActive }) => `conversation${isActive ? ' is-active' : ''}`}
      >
        <EmployeeAvatar employee={employee} size={42} />
        <span className="conversation__body">
          <span className="conversation__top">
            <span className="conversation__name">{employee.full_name}</span>
            {conversation.last_message_at && (
              <span className="conversation__time">{formatRelativeDay(conversation.last_message_at)}</span>
            )}
          </span>
          <span className="conversation__bottom">
            <span className="conversation__preview">
              {conversation.last_message
                ? `${isOwnLast ? 'You: ' : ''}${conversation.last_message}`
                : 'No messages yet'}
            </span>
            {conversation.unread_count > 0 && (
              <span className="unread-badge" aria-label={`${conversation.unread_count} unread`}>
                {conversation.unread_count > 99 ? '99+' : conversation.unread_count}
              </span>
            )}
          </span>
        </span>
      </NavLink>
    </li>
  );
}

function InfoPanel({ conversation, onClose }) {
  const employee = toEmployee(conversation);
  const { onlineIds } = useWorkspace();

  return (
    <aside className="thread-info" aria-label="Conversation details">
      <header className="thread-info__header">
        <h2>Details</h2>
        <button type="button" className="icon-button" aria-label="Close details" onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      <div className="thread-info__person">
        <EmployeeAvatar employee={employee} size={72} />
        <p className="profile-head__name">{employee.full_name}</p>
        {employee.username && <p className="row__meta">@{employee.username}</p>}
        <p className="row__meta">{onlineIds.has(employee.id) ? 'Online' : 'Offline'}</p>
      </div>
      <dl className="detail-list">
        <dt>Department</dt>
        <dd>{employee.department || 'Not set'}</dd>
        <dt>Designation</dt>
        <dd>{employee.designation || 'Not set'}</dd>
      </dl>
      {conversation.employee_id && (
        <Link to={`/employees/${employee.id}`} className="thread-info__link">
          View full profile
        </Link>
      )}
      <SharedFilesSection conversationId={conversation.id} />
    </aside>
  );
}

export default function MessagesPage() {
  const { conversationId } = useParams();
  const { user } = useAuth();
  const { subscribeToMessages, resyncAt, lastEventAt } = useWorkspace();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const [selected, setSelected] = useState({ status: 'idle', conversation: null, error: '' });

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const fetchPage = useCallback((page) => listConversations({ search, ...page }), [search]);
  const list = usePagedList(fetchPage, search, CONVERSATION_PAGE_SIZE);
  const { refresh } = list;

  // Several events can land together, so refreshing the list is briefly delayed.
  const refreshTimer = useRef(null);
  const scheduleRefresh = useCallback(() => {
    clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(refresh, LIST_REFRESH_DELAY_MS);
  }, [refresh]);
  useEffect(() => () => clearTimeout(refreshTimer.current), []);

  useEffect(
    () =>
      subscribeToMessages(({ type }) => {
        if (type === 'message') scheduleRefresh();
      }),
    [subscribeToMessages, scheduleRefresh],
  );

  useEffect(() => {
    if (resyncAt || lastEventAt) scheduleRefresh();
  }, [resyncAt, lastEventAt, scheduleRefresh]);

  const loadSelected = useCallback(async (id, isCurrent, showLoading) => {
    if (showLoading) setSelected({ status: 'loading', conversation: null, error: '' });
    try {
      const conversation = await getConversation(id);
      if (isCurrent()) setSelected({ status: 'ready', conversation, error: '' });
    } catch (error) {
      if (isCurrent()) {
        setSelected((current) =>
          current.conversation
            ? current
            : { status: 'error', conversation: null, error: error?.message || 'Something went wrong.' },
        );
      }
    }
  }, []);

  useEffect(() => {
    if (!conversationId) {
      setSelected({ status: 'idle', conversation: null, error: '' });
      return undefined;
    }
    let isActive = true;
    loadSelected(conversationId, () => isActive, true);
    return () => {
      isActive = false;
    };
  }, [conversationId, loadSelected]);

  // Picks up a connection being removed or restored while the chat is open.
  useEffect(() => {
    if (!conversationId || !resyncAt) return undefined;
    let isActive = true;
    loadSelected(conversationId, () => isActive, false);
    return () => {
      isActive = false;
    };
  }, [resyncAt, conversationId, loadSelected]);

  const emptyState = useMemo(
    () =>
      search ? (
        <EmptyState icon={Search} title="No matching conversations">
          Try a different name.
        </EmptyState>
      ) : (
        <EmptyState icon={MessageSquare} title="No conversations yet">
          Open <Link to="/connections">My Connections</Link> and choose Message to start one.
        </EmptyState>
      ),
    [search],
  );

  const { conversation } = selected;

  return (
    <div
      className={`messages${conversationId ? ' messages--thread' : ''}${
        conversation && isInfoOpen ? ' messages--info' : ''
      }`}
    >
      <section className="conversations" aria-label="Conversations">
        <header className="conversations__header">
          <h1 className="page__title">Direct Messages</h1>
          <label className="filter-input">
            <span className="sr-only">Search conversations by name</span>
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              placeholder="Search by name"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
          </label>
        </header>
        <div className="conversations__list">
          <PagedList list={list} emptyState={emptyState}>
            {list.items.map((item) => (
              <ConversationRow key={item.id} conversation={item} userId={user?.id} />
            ))}
          </PagedList>
        </div>
      </section>

      <div className="messages__main">
        {!conversationId && (
          <EmptyState icon={MessageSquare} title="Select a conversation">
            Choose a conversation on the left, or start one from My Connections.
          </EmptyState>
        )}
        {selected.status === 'loading' && (
          <div className="thread__notice">
            <ListSkeleton rows={3} />
          </div>
        )}
        {selected.status === 'error' && (
          <div className="thread__notice">
            <Alert variant="error" title="Couldn’t open this conversation">
              {selected.error}
            </Alert>
          </div>
        )}
        {selected.status === 'ready' && !conversation && (
          <EmptyState icon={MessageSquareOff} title="Conversation not available">
            It may not exist, or you may not be part of it.
          </EmptyState>
        )}
        {conversation && (
          <MessageThread
            key={conversation.id}
            conversation={conversation}
            userId={user?.id}
            isInfoOpen={isInfoOpen}
            onToggleInfo={() => setIsInfoOpen((open) => !open)}
            onActivity={scheduleRefresh}
          />
        )}
      </div>

      {conversation && isInfoOpen && <InfoPanel conversation={conversation} onClose={() => setIsInfoOpen(false)} />}
    </div>
  );
}
