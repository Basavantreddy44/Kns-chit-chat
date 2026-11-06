import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, useNavigate, useParams } from 'react-router-dom';
import { Hash, ListPlus, Search, ShieldOff } from 'lucide-react';
import ChannelDetails from '../../components/channels/ChannelDetails';
import { ChannelIcon, memberCountLabel } from '../../components/channels/ChannelParts';
import ChannelThread from '../../components/channels/ChannelThread';
import Alert from '../../components/common/Alert';
import Button from '../../components/common/Button';
import { EmptyState, ListSkeleton, PagedList } from '../../components/workspace/PageParts';
import { useAuth } from '../../context/AuthContext';
import { useWorkspace } from '../../context/WorkspaceContext';
import { usePagedList } from '../../hooks/usePagedList';
import {
  CHANNEL_PAGE_SIZE,
  declineInvitation,
  getChannel,
  joinChannel,
  listChannels,
} from '../../services/channelService';
import { formatRelativeDay } from '../../utils/format';

const SEARCH_DELAY_MS = 300;
const LIST_REFRESH_DELAY_MS = 250;

function ChannelListRow({ channel }) {
  return (
    <li>
      <NavLink to={`/channels/${channel.id}`} className={({ isActive }) => `conversation${isActive ? ' is-active' : ''}`}>
        <ChannelIcon channel={channel} size={42} />
        <span className="conversation__body">
          <span className="conversation__top">
            <span className="conversation__name">{channel.name}</span>
            {channel.last_message_at && (
              <span className="conversation__time">{formatRelativeDay(channel.last_message_at)}</span>
            )}
          </span>
          <span className="conversation__bottom">
            <span className="conversation__preview">
              {channel.archived_at ? 'Archived' : memberCountLabel(channel.member_count)}
            </span>
            {channel.unread_count > 0 && (
              <span className="unread-badge" aria-label={`${channel.unread_count} unread`}>
                {channel.unread_count > 99 ? '99+' : channel.unread_count}
              </span>
            )}
          </span>
        </span>
      </NavLink>
    </li>
  );
}

/** What someone sees before they're a member: join, or answer an invitation. */
function ChannelGate({ channel, onChanged, onDeclined }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const isInvited = channel.my_status === 'invited';

  const run = async (name, action, after) => {
    setBusy(name);
    setError('');
    try {
      await action();
      await after();
    } catch (actionError) {
      setError(actionError?.message || 'Something went wrong. Please try again.');
      setBusy('');
    }
  };

  return (
    <div className="channel-gate">
      <div className="channel-gate__card">
        <ChannelIcon channel={channel} size={56} />
        <h1 className="empty__title">{channel.name}</h1>
        <p className="row__meta">
          {memberCountLabel(channel.member_count)}
          {channel.owner_name ? ` · Owner: ${channel.owner_name}` : ''}
        </p>
        {channel.description && <p className="channel-description">{channel.description}</p>}
        <p className="row__meta">
          {isInvited
            ? 'You have been invited to this channel.'
            : 'Join this channel to read its messages and post.'}
        </p>
        {error && <Alert variant="error">{error}</Alert>}
        {channel.archived_at ? (
          <p className="row__meta">This channel is archived, so it can’t be joined.</p>
        ) : (
          <div className="channel-gate__actions">
            <Button
              onClick={() => run('join', () => joinChannel(channel.id), onChanged)}
              isLoading={busy === 'join'}
              loadingText="Joining…"
              disabled={Boolean(busy)}
            >
              {isInvited ? 'Accept invitation' : 'Join channel'}
            </Button>
            {isInvited && (
              <Button
                variant="outline"
                onClick={() => run('decline', () => declineInvitation(channel.id), onDeclined)}
                isLoading={busy === 'decline'}
                loadingText="Declining…"
                disabled={Boolean(busy)}
              >
                Decline
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** My Channels: the channels you belong to, alongside the one that's open. */
export default function ChannelsPage() {
  const { channelId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { subscribeToMessages, resyncAt, lastEventAt, refreshUnread } = useWorkspace();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const [selected, setSelected] = useState({ status: 'idle', channel: null, error: '' });

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const fetchMine = useCallback((page) => listChannels({ scope: 'mine', search, ...page }), [search]);
  const mine = usePagedList(fetchMine, search, CHANNEL_PAGE_SIZE);
  const fetchInvited = useCallback((page) => listChannels({ scope: 'invited', ...page }), []);
  const invited = usePagedList(fetchInvited, 'invited', CHANNEL_PAGE_SIZE);
  const refreshMine = mine.refresh;
  const refreshInvited = invited.refresh;

  // Several events can land together, so refreshing the lists is briefly delayed.
  const refreshTimer = useRef(null);
  const scheduleRefresh = useCallback(() => {
    clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      refreshMine();
      refreshInvited();
    }, LIST_REFRESH_DELAY_MS);
  }, [refreshMine, refreshInvited]);
  useEffect(() => () => clearTimeout(refreshTimer.current), []);

  useEffect(
    () =>
      subscribeToMessages(({ type }) => {
        if (type === 'channel_message') scheduleRefresh();
      }),
    [subscribeToMessages, scheduleRefresh],
  );

  const loadSelected = useCallback(async (id, isCurrent, showLoading) => {
    if (showLoading) setSelected({ status: 'loading', channel: null, error: '' });
    try {
      const channel = await getChannel(id);
      if (isCurrent()) setSelected({ status: 'ready', channel, error: '' });
    } catch (error) {
      if (isCurrent()) {
        setSelected((current) =>
          current.channel ? current : { status: 'error', channel: null, error: error?.message || 'Something went wrong.' },
        );
      }
    }
  }, []);

  useEffect(() => {
    setIsInfoOpen(false);
    if (!channelId) {
      setSelected({ status: 'idle', channel: null, error: '' });
      return undefined;
    }
    let isActive = true;
    loadSelected(channelId, () => isActive, true);
    return () => {
      isActive = false;
    };
  }, [channelId, loadSelected]);

  // Removed, archived or renamed while open: a reconnect, focus or event catches it.
  useEffect(() => {
    if (!(resyncAt || lastEventAt)) return undefined;
    scheduleRefresh();
    if (!channelId) return undefined;
    let isActive = true;
    loadSelected(channelId, () => isActive, false);
    return () => {
      isActive = false;
    };
  }, [resyncAt, lastEventAt, channelId, loadSelected, scheduleRefresh]);

  const refreshAfterChange = useCallback(async () => {
    refreshUnread();
    scheduleRefresh();
    if (channelId) await loadSelected(channelId, () => true, false);
  }, [channelId, loadSelected, refreshUnread, scheduleRefresh]);

  const { channel } = selected;
  const isMember = channel?.my_status === 'active';

  return (
    <div
      className={`messages${channelId ? ' messages--thread' : ''}${isMember && isInfoOpen ? ' messages--info' : ''}`}
    >
      <section className="conversations" aria-label="My channels">
        <header className="conversations__header">
          <h1 className="page__title">My Channels</h1>
          <label className="filter-input">
            <span className="sr-only">Search my channels</span>
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              placeholder="Search my channels"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
          </label>
        </header>

        <div className="conversations__list">
          {invited.items.length > 0 && (
            <>
              <p className="channel-group__title">Invitations</p>
              <ul className="row-list">
                {invited.items.map((item) => (
                  <li key={item.id}>
                    <Link to={`/channels/${item.id}`} className="channel-invite">
                      <ChannelIcon channel={item} size={42} />
                      <span className="conversation__body">
                        <span className="conversation__name">{item.name}</span>
                        <span className="conversation__preview">Invitation: respond to join</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="channel-group__title">Joined</p>
            </>
          )}
          <PagedList
            list={mine}
            emptyState={
              search ? (
                <EmptyState icon={Search} title="No matching channels">
                  Try a different name.
                </EmptyState>
              ) : (
                <EmptyState icon={Hash} title="You haven’t joined any channels">
                  Browse <Link to="/channels">All Channels</Link>, or{' '}
                  <Link to="/channels/new">create your own</Link>.
                </EmptyState>
              )
            }
          >
            {mine.items.map((item) => (
              <ChannelListRow key={item.id} channel={item} />
            ))}
          </PagedList>
        </div>
      </section>

      <div className="messages__main">
        {!channelId && (
          <EmptyState icon={ListPlus} title="Select a channel">
            Choose a channel on the left, or browse <Link to="/channels">All Channels</Link>.
          </EmptyState>
        )}
        {selected.status === 'loading' && (
          <div className="thread__notice">
            <ListSkeleton rows={3} />
          </div>
        )}
        {selected.status === 'error' && (
          <div className="thread__notice">
            <Alert variant="error" title="Couldn’t open this channel">
              {selected.error}
            </Alert>
          </div>
        )}
        {selected.status === 'ready' && !channel && (
          <EmptyState icon={ShieldOff} title="Channel not available">
            It may not exist, or you may not have access to it. <Link to="/channels">Browse All Channels</Link>.
          </EmptyState>
        )}
        {channel && !isMember && (
          <ChannelGate
            key={`${channel.id}-${channel.my_status}`}
            channel={channel}
            onChanged={refreshAfterChange}
            onDeclined={async () => {
              refreshUnread();
              scheduleRefresh();
              navigate('/channels/mine', { replace: true });
            }}
          />
        )}
        {channel && isMember && (
          <ChannelThread
            key={channel.id}
            channel={channel}
            userId={user?.id}
            isInfoOpen={isInfoOpen}
            onToggleInfo={() => setIsInfoOpen((open) => !open)}
            onActivity={scheduleRefresh}
          />
        )}
      </div>

      {channel && isMember && isInfoOpen && (
        <ChannelDetails
          key={channel.id}
          channel={channel}
          userId={user?.id}
          onClose={() => setIsInfoOpen(false)}
          onChanged={refreshAfterChange}
        />
      )}
    </div>
  );
}
