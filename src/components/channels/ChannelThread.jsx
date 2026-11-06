import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Info, Search, X } from 'lucide-react';
import { ChannelIcon, memberCountLabel } from './ChannelParts';
import { DropOverlay, UploadQueue, useFileDrop } from '../files/FileParts';
import { Composer, MessageList, ThreadSearch } from '../messaging/MessageParts';
import { useMessageThread } from '../../hooks/useMessageThread';
import { useSenders } from '../../hooks/useSenders';
import { useFileUploads, useMessageFiles } from '../../hooks/useThreadFiles';
import { shareChannelFile } from '../../services/fileService';
import {
  listChannelMessages,
  markChannelRead,
  searchChannelMessages,
  sendChannelMessage,
} from '../../services/channelService';
import { MESSAGE_PAGE_SIZE } from '../../services/messagingService';

/** The message view of a channel the signed-in employee has joined. */
export default function ChannelThread({ channel, userId, isInfoOpen, onToggleInfo, onActivity }) {
  const channelId = channel.id;
  const source = useMemo(
    () => ({
      eventType: 'channel_message',
      belongs: (row) => row.channel_id === channelId,
      fetchPage: (before) => listChannelMessages(channelId, before),
      post: (content, clientId) => sendChannelMessage(channelId, content, clientId),
      markRead: () => markChannelRead(channelId),
      draftFields: { channel_id: channelId },
      pageSize: MESSAGE_PAGE_SIZE,
    }),
    [channelId],
  );

  const thread = useMessageThread(source, userId);
  const senderOf = useSenders(thread.messages);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const search = useCallback((query) => searchChannelMessages(channelId, query), [channelId]);

  const uploadTarget = useMemo(
    () => ({
      prefix: `channels/${channelId}`,
      share: (path, name, clientId) => shareChannelFile(channelId, path, name, clientId),
    }),
    [channelId],
  );
  const uploads = useFileUploads(uploadTarget, thread.receive);
  const files = useMessageFiles(thread.messages, 'channel');
  const { isDragging, dropProps } = useFileDrop(uploads.addFiles, !channel.archived_at);

  return (
    <section className="thread" aria-label={`Channel ${channel.name}`} {...dropProps}>
      {isDragging && <DropOverlay />}
      <header className="thread__header">
        <Link to="/channels/mine" className="icon-button thread__back" aria-label="Back to my channels">
          <ArrowLeft size={20} aria-hidden="true" />
        </Link>
        <ChannelIcon channel={channel} size={38} />
        <div className="row__body">
          <h1 className="thread__title">{channel.name}</h1>
          <p className="row__meta">{memberCountLabel(channel.member_count)}</p>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Search this channel"
          aria-expanded={isSearchOpen}
          onClick={() => setIsSearchOpen((open) => !open)}
        >
          {isSearchOpen ? <X size={20} aria-hidden="true" /> : <Search size={20} aria-hidden="true" />}
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Channel details"
          aria-expanded={isInfoOpen}
          onClick={onToggleInfo}
        >
          <Info size={20} aria-hidden="true" />
        </button>
      </header>

      {isSearchOpen && <ThreadSearch search={search} label="Search this channel" onClose={() => setIsSearchOpen(false)} />}

      <MessageList
        thread={thread}
        userId={userId}
        senderOf={senderOf}
        labelFor={(message) => (message.pending && !message.failed ? 'Sending…' : '')}
        onActivity={onActivity}
        files={files}
        emptyState={
          <div className="empty">
            <ChannelIcon channel={channel} size={56} />
            <h2 className="empty__title">Welcome to {channel.name}</h2>
            <p>{channel.description || 'Be the first to post a message.'}</p>
          </div>
        }
      />

      <UploadQueue uploads={uploads.uploads} onRetry={uploads.retry} onCancel={uploads.cancel} onDismiss={uploads.dismiss} />

      {channel.archived_at ? (
        <p className="thread__blocked">This channel is archived. You can read its history, but it takes no new messages.</p>
      ) : (
        <Composer
          disabled={thread.status !== 'ready'}
          onSend={thread.send}
          onAttach={uploads.addFiles}
          placeholder={`Message ${channel.name}…`}
        />
      )}
    </section>
  );
}
