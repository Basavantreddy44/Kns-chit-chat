import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, useParams } from 'react-router-dom';
import { Plus, Search, ShieldOff, UsersRound } from 'lucide-react';
import Alert from '../../components/common/Alert';
import GroupDetails from '../../components/groups/GroupDetails';
import GroupThread, { GroupIcon } from '../../components/groups/GroupThread';
import { EmptyState, ListSkeleton, PagedList } from '../../components/workspace/PageParts';
import { useAuth } from '../../context/AuthContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import { usePagedList } from '../../hooks/usePagedList';
import { getGroup, GROUP_PAGE_SIZE, listGroups } from '../../services/groupService';
import { formatRelativeDay } from '../../utils/format';

const SEARCH_DELAY_MS = 300;
const LIST_REFRESH_DELAY_MS = 250;

function GroupRow({ group, userId }) {
  const sender = group.last_sender_id === userId ? 'You' : group.last_sender_name?.split(' ')[0];

  return (
    <li>
      <NavLink to={`/groups/${group.id}`} className={({ isActive }) => `conversation${isActive ? ' is-active' : ''}`}>
        <GroupIcon size={42} />
        <span className="conversation__body">
          <span className="conversation__top">
            <span className="conversation__name">{group.name}</span>
            {group.last_message_at && (
              <span className="conversation__time">{formatRelativeDay(group.last_message_at)}</span>
            )}
          </span>
          <span className="conversation__bottom">
            <span className="conversation__preview">
              {group.last_message ? `${sender ? `${sender}: ` : ''}${group.last_message}` : 'No messages yet'}
            </span>
            {group.unread_count > 0 && (
              <span className="unread-badge" aria-label={`${group.unread_count} unread`}>
                {group.unread_count > 99 ? '99+' : group.unread_count}
              </span>
            )}
          </span>
        </span>
      </NavLink>
    </li>
  );
}

export default function GroupsPage() {
  const { groupId } = useParams();
  const { user } = useAuth();
  const { subscribeToMessages, resyncAt, lastEventAt, refreshUnread } = useWorkspace();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const [selected, setSelected] = useState({ status: 'idle', group: null, error: '' });

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const fetchPage = useCallback((page) => listGroups({ search, ...page }), [search]);
  const list = usePagedList(fetchPage, search, GROUP_PAGE_SIZE);
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

  const loadSelected = useCallback(async (id, isCurrent, showLoading) => {
    if (showLoading) setSelected({ status: 'loading', group: null, error: '' });
    try {
      const group = await getGroup(id);
      if (isCurrent()) setSelected({ status: 'ready', group, error: '' });
    } catch (error) {
      if (isCurrent()) {
        setSelected((current) =>
          current.group ? current : { status: 'error', group: null, error: error?.message || 'Something went wrong.' },
        );
      }
    }
  }, []);

  useEffect(() => {
    setIsInfoOpen(false);
    if (!groupId) {
      setSelected({ status: 'idle', group: null, error: '' });
      return undefined;
    }
    let isActive = true;
    loadSelected(groupId, () => isActive, true);
    return () => {
      isActive = false;
    };
  }, [groupId, loadSelected]);

  // Added, removed or renamed while open: a reconnect, focus or event catches it.
  useEffect(() => {
    if (!(resyncAt || lastEventAt)) return undefined;
    scheduleRefresh();
    if (!groupId) return undefined;
    let isActive = true;
    loadSelected(groupId, () => isActive, false);
    return () => {
      isActive = false;
    };
  }, [resyncAt, lastEventAt, groupId, loadSelected, scheduleRefresh]);

  const refreshAfterChange = useCallback(async () => {
    refreshUnread();
    scheduleRefresh();
    if (groupId) await loadSelected(groupId, () => true, false);
  }, [groupId, loadSelected, refreshUnread, scheduleRefresh]);

  const { group } = selected;

  return (
    <div className={`messages${groupId ? ' messages--thread' : ''}${group && isInfoOpen ? ' messages--info' : ''}`}>
      <section className="conversations" aria-label="Group chats">
        <header className="conversations__header">
          <div className="conversations__title-row">
            <h1 className="page__title">Group Chats</h1>
            <Link to="/groups/new" className="icon-button" aria-label="Create group">
              <Plus size={20} aria-hidden="true" />
            </Link>
          </div>
          <label className="filter-input">
            <span className="sr-only">Search groups by name</span>
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              placeholder="Search groups"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
          </label>
        </header>
        <div className="conversations__list">
          <PagedList
            list={list}
            emptyState={
              search ? (
                <EmptyState icon={Search} title="No matching groups">
                  Try a different name.
                </EmptyState>
              ) : (
                <EmptyState icon={UsersRound} title="No group chats yet">
                  <Link to="/groups/new">Create a group</Link> with your connections.
                </EmptyState>
              )
            }
          >
            {list.items.map((item) => (
              <GroupRow key={item.id} group={item} userId={user?.id} />
            ))}
          </PagedList>
        </div>
      </section>

      <div className="messages__main">
        {!groupId && (
          <EmptyState icon={UsersRound} title="Select a group">
            Choose a group on the left, or <Link to="/groups/new">create a new one</Link>.
          </EmptyState>
        )}
        {selected.status === 'loading' && (
          <div className="thread__notice">
            <ListSkeleton rows={3} />
          </div>
        )}
        {selected.status === 'error' && (
          <div className="thread__notice">
            <Alert variant="error" title="Couldn’t open this group">
              {selected.error}
            </Alert>
          </div>
        )}
        {selected.status === 'ready' && !group && (
          <EmptyState icon={ShieldOff} title="Group not available">
            It may not exist, or you may not be part of it.
          </EmptyState>
        )}
        {group && (
          <GroupThread
            key={group.id}
            group={group}
            userId={user?.id}
            isInfoOpen={isInfoOpen}
            onToggleInfo={() => setIsInfoOpen((open) => !open)}
            onActivity={scheduleRefresh}
          />
        )}
      </div>

      {group && isInfoOpen && (
        <GroupDetails
          key={group.id}
          group={group}
          userId={user?.id}
          onClose={() => setIsInfoOpen(false)}
          onChanged={refreshAfterChange}
        />
      )}
    </div>
  );
}
