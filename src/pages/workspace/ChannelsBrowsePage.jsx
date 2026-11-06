import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Hash, ListPlus, Search } from 'lucide-react';
import { ChannelIcon, ChannelTags, memberCountLabel } from '../../components/channels/ChannelParts';
import Alert from '../../components/common/Alert';
import Button from '../../components/common/Button';
import { EmptyState, PagedList, PageHeader } from '../../components/workspace/PageParts';
import { CHANNEL_CATEGORIES } from '../../config/channelCategories';
import { useWorkspace } from '../../context/WorkspaceContext';
import { usePagedList } from '../../hooks/usePagedList';
import { CHANNEL_PAGE_SIZE, joinChannel, listChannels } from '../../services/channelService';

const SEARCH_DELAY_MS = 300;

function JoinButton({ channel, onJoined, onError }) {
  const [isJoining, setIsJoining] = useState(false);

  const join = async () => {
    setIsJoining(true);
    onError('');
    try {
      await joinChannel(channel.id);
      await onJoined(channel.id);
    } catch (error) {
      onError(error?.message || 'Something went wrong. Please try again.');
      setIsJoining(false);
    }
  };

  return (
    <Button onClick={join} isLoading={isJoining} loadingText="Joining…" aria-label={`Join ${channel.name}`}>
      Join
    </Button>
  );
}

/** All Channels: everything the employee can discover. */
export default function ChannelsBrowsePage() {
  const navigate = useNavigate();
  const { lastEventAt } = useWorkspace();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const resetKey = useMemo(() => JSON.stringify([search, category]), [search, category]);
  const fetchPage = useCallback(
    (page) => listChannels({ scope: 'all', search, category, ...page }),
    [search, category],
  );
  const list = usePagedList(fetchPage, resetKey, CHANNEL_PAGE_SIZE);
  const { refresh } = list;

  useEffect(() => {
    if (lastEventAt) refresh();
  }, [lastEventAt, refresh]);

  const isFiltered = Boolean(search || category);

  return (
    <div className="page">
      <PageHeader title="All Channels" subtitle="Join the spaces where your teams and projects work together.">
        <Link to="/channels/new" className="btn btn--primary channel-create-link">
          <ListPlus size={16} aria-hidden="true" /> Create Channel
        </Link>
      </PageHeader>

      <div className="filters filters--two">
        <label className="filter-input">
          <span className="sr-only">Search channels</span>
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            placeholder="Search by name, description or category"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </label>
        <label>
          <span className="sr-only">Filter by category</span>
          <select className="select" value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="">All categories</option>
            {CHANNEL_CATEGORIES.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {actionError && (
        <div className="page__stack" style={{ marginBottom: 'var(--space-4)' }}>
          <Alert variant="error" onDismiss={() => setActionError('')}>
            {actionError}
          </Alert>
        </div>
      )}

      <PagedList
        list={list}
        emptyState={
          <EmptyState icon={Hash} title={isFiltered ? 'No matching channels' : 'No channels yet'}>
            {isFiltered ? (
              'Try a different search or clear the filter.'
            ) : (
              <>
                Be the first to <Link to="/channels/new">create a channel</Link>.
              </>
            )}
          </EmptyState>
        }
      >
        {list.items.map((channel) => (
          <li key={channel.id} className="row">
            <ChannelIcon channel={channel} size={44} />
            <div className="row__body">
              <Link to={`/channels/${channel.id}`} className="row__name">
                {channel.name}
              </Link>
              {channel.description && <p className="channel-row__description">{channel.description}</p>}
              <p className="row__meta">
                {memberCountLabel(channel.member_count)}
                {channel.owner_name ? ` · Owner: ${channel.owner_name}` : ''}
              </p>
              <div className="channel-row__tags">
                <ChannelTags channel={channel} />
              </div>
            </div>
            <div className="row__actions">
              {channel.my_status === 'active' ? (
                <Link to={`/channels/${channel.id}`} className="row__link" aria-label={`Open ${channel.name}`}>
                  Open
                </Link>
              ) : channel.my_status === 'invited' ? (
                <Link to={`/channels/${channel.id}`} className="row__link" aria-label={`Respond to invitation to ${channel.name}`}>
                  View invitation
                </Link>
              ) : (
                <JoinButton
                  channel={channel}
                  onError={setActionError}
                  onJoined={(id) => navigate(`/channels/${id}`)}
                />
              )}
            </div>
          </li>
        ))}
      </PagedList>
    </div>
  );
}
